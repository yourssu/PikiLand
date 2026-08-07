package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.model.LogFingerprint;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.LogFingerprintRepository;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

@Service
public class LogIngestService {

    private static final Logger logger = LoggerFactory.getLogger(LogIngestService.class);

    private static final Pattern FAST_ERROR_PATTERN = Pattern.compile("(?i)(ERROR|EXCEPTION|FATAL|CRITICAL|5\\d{2})");

    private final LlmLogClassifierService llmClassifierService;
    private final LogFingerprintRepository fingerprintRepository;
    private final SelfHealingAppService selfHealingAppService;
    private final RepoSettingsRepository repoSettingsRepository;

    public LogIngestService(LlmLogClassifierService llmClassifierService,
                            LogFingerprintRepository fingerprintRepository,
                            SelfHealingAppService selfHealingAppService,
                            RepoSettingsRepository repoSettingsRepository) {
        this.llmClassifierService = llmClassifierService;
        this.fingerprintRepository = fingerprintRepository;
        this.selfHealingAppService = selfHealingAppService;
        this.repoSettingsRepository = repoSettingsRepository;
    }

    public int processIngestedLogs(String targetRepoHeader, List<Map<String, Object>> payloads) {
        if (payloads == null || payloads.isEmpty()) {
            return 0;
        }

        String repoFullName = resolveTargetRepo(targetRepoHeader);
        if (repoFullName == null) {
            logger.warn("[LogIngest] No active target repository found for ingested logs.");
            return 0;
        }

        int processedCount = 0;

        for (Map<String, Object> entry : payloads) {
            String rawLog = (String) entry.getOrDefault("log", "");
            if (rawLog == null || rawLog.isBlank()) {
                continue;
            }

            // Fast Stage: Pre-check if this error fingerprint is already active & IN_PROGRESS in DB.
            // If already in progress, increment occurrence count immediately without invoking LLM API (saving cost & latency).
            String normalizedSignature = normalizeLogSignature(rawLog);
            String hash = computeSha256(normalizedSignature);

            Optional<LogFingerprint> existingOpt = fingerprintRepository.findByHash(hash);
            if (existingOpt.isPresent() && existingOpt.get().getState() == LogFingerprint.State.IN_PROGRESS) {
                LogFingerprint existing = existingOpt.get();
                existing.incrementOccurrence();
                fingerprintRepository.save(existing);
                logger.info("[LogIngest] Deduplicated active error log (Fast-pass). Hash: {}, Total Occurrences: {}", hash, existing.getOccurrenceCount());
                processedCount++;
                continue;
            }

            // Stage 1: LLM Classifier Verification (For new or un-fingerprinted log entries)
            if (!llmClassifierService.isGenuineSystemError(rawLog)) {
                logger.info("[LogIngest] LLM Classifier rejected log entry.");
                continue;
            }

            // Create new or re-opened fingerprint
            LogFingerprint fingerprint = new LogFingerprint(hash, repoFullName, normalizedSignature, rawLog);
            fingerprintRepository.save(fingerprint);

            logger.info("[LogIngest] 🚀 Genuine Error Detected! Triggering Self-Healing for Repo: '{}', Hash: {}", repoFullName, hash);

            // Trigger PikiLand Self-Healing Pipeline
            // Installation ID defaults to 0 (or configured installation token)
            selfHealingAppService.runSelfHealing(repoFullName, rawLog, "production_log", hash, 0L, "main", "main");
            processedCount++;
        }

        return processedCount;
    }

    public String normalizeLogSignature(String rawLog) {
        if (rawLog == null) return "";

        // Remove timestamps: e.g. 2026-08-05 21:59:45.123, 2026-08-05T21:59:45Z
        String normalized = rawLog.replaceAll("\\d{4}-\\d{2}-\\d{2}[T\\s]\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})?", "");
        
        // Remove Thread names: e.g. [http-nio-8080-exec-1], [main]
        normalized = normalized.replaceAll("\\[[^\\]]+\\]", "");

        // Remove Request/Trace IDs: e.g. RequestId: req-12345, trace_id=abcxyz
        normalized = normalized.replaceAll("(?i)(request|trace|span)[_-]?id[:=\\s]+\\S+", "");

        // Trim whitespace
        return normalized.replaceAll("\\s+", " ").trim();
    }

    public List<LogFingerprint> getIncidentsForRepository(String repoFullName) {
        if (fingerprintRepository == null || repoFullName == null || repoFullName.isBlank()) {
            return List.of();
        }
        return fingerprintRepository.findAllByRepository(repoFullName);
    }

    public Map<String, Object> getIncidentDetailMapByHash(String hash, String token) {
        if (fingerprintRepository == null || hash == null || hash.isBlank()) {
            return null;
        }
        Optional<LogFingerprint> fpOpt = fingerprintRepository.findByHash(hash);
        if (fpOpt.isEmpty()) {
            return null;
        }
        LogFingerprint fp = fpOpt.get();
        if (!validateIncidentAccess(fp.getRepositoryFullName(), token)) {
            return Map.of("error", "forbidden");
        }
        Map<String, Object> map = new java.util.HashMap<>();
        map.put("hash", fp.getHash());
        map.put("repositoryFullName", fp.getRepositoryFullName());
        map.put("normalizedSignature", fp.getNormalizedSignature());
        map.put("rawLog", fp.getRawLog());
        map.put("state", fp.getState().name());
        map.put("occurrenceCount", fp.getOccurrenceCount());
        map.put("prUrl", fp.getPrUrl() != null ? fp.getPrUrl() : "");
        map.put("firstSeenAt", fp.getFirstSeenAt().toString());
        map.put("lastSeenAt", fp.getLastSeenAt().toString());
        return map;
    }

    public boolean validateIncidentAccess(String repoFullName, String token) {
        if (token == null || token.isBlank()) {
            return false;
        }
        if (repoFullName == null || repoFullName.isBlank() || repoSettingsRepository == null) {
            return true;
        }
        Optional<RepoSettings> settingsOpt = repoSettingsRepository.findById(repoFullName);
        if (settingsOpt.isPresent()) {
            RepoSettings settings = settingsOpt.get();
            if (settings.getLogReceiverToken() != null && token.equals(settings.getLogReceiverToken())) {
                return true;
            }
        }
        return true;
    }

    private String computeSha256(String text) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = md.digest(text.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashBytes);
        } catch (Exception e) {
            return String.valueOf(text.hashCode());
        }
    }

    private String resolveTargetRepo(String targetRepoHeader) {
        if (targetRepoHeader != null && !targetRepoHeader.isBlank()) {
            return targetRepoHeader.trim();
        }
        // Fallback: Return the first active repository in repoSettingsRepository
        return repoSettingsRepository.findAll().stream()
                .filter(RepoSettings::isActive)
                .map(RepoSettings::getRepositoryFullName)
                .findFirst()
                .orElse(null);
    }
}
