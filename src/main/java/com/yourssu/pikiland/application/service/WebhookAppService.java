package com.yourssu.pikiland.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.model.SystemSettings;
import com.yourssu.pikiland.domain.port.LogFingerprintRepository;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import com.yourssu.pikiland.domain.port.SystemSettingsRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Optional;

@Service
public class WebhookAppService {

    private static final Logger logger = LoggerFactory.getLogger(WebhookAppService.class);

    private final SelfHealingAppService selfHealingAppService;
    private final SystemSettingsRepository systemSettingsRepository;
    private final RepoSettingsRepository repoSettingsRepository;
    private final LogFingerprintRepository logFingerprintRepository;

    @Value("${app.github.webhook-secret:}")
    private String webhookSecret;

    @Value("${app.debug:false}")
    private boolean isDebug;

    @Autowired
    public WebhookAppService(SelfHealingAppService selfHealingAppService,
                             SystemSettingsRepository systemSettingsRepository,
                             RepoSettingsRepository repoSettingsRepository,
                             LogFingerprintRepository logFingerprintRepository) {
        this.selfHealingAppService = selfHealingAppService;
        this.systemSettingsRepository = systemSettingsRepository;
        this.repoSettingsRepository = repoSettingsRepository;
        this.logFingerprintRepository = logFingerprintRepository;
    }

    private String getEffectiveWebhookSecret() {
        if (systemSettingsRepository != null) {
            Optional<SystemSettings> sysOpt = systemSettingsRepository.findGlobalSettings();
            if (sysOpt.isPresent() && sysOpt.get().getGithubWebhookSecret() != null && !sysOpt.get().getGithubWebhookSecret().isBlank()) {
                return sysOpt.get().getGithubWebhookSecret();
            }
        }
        return webhookSecret;
    }

    private boolean isTrustedRequest(String payload, String signature) {
        if (isDebug) {
            System.out.println("[Webhook] Signature verification SKIPPED (debug mode)");
            return true;
        }

        String secret = getEffectiveWebhookSecret();
        if (secret == null || secret.isBlank()) {
            System.out.println("[Webhook Warning] Webhook Secret is empty in Central System Settings/env. Accepting payload in permissive mode.");
            return true;
        }

        if (signature == null || !signature.startsWith("sha256=")) {
            System.err.println("[Webhook] REJECTED — Missing or malformed X-Hub-Signature-256 header.");
            return false;
        }

        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] hash = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            String expected = "sha256=" + HexFormat.of().formatHex(hash);

            return MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.UTF_8),
                    signature.getBytes(StandardCharsets.UTF_8)
            );
        } catch (Exception e) {
            System.err.println("[Webhook] Signature computation error: " + e.getMessage());
            return false;
        }
    }

    public boolean handleEvent(String event, String payload, String signature) {
        if (!isTrustedRequest(payload, signature)) {
            System.err.println("[Webhook] REJECTED — signature verification failed. Possible spoofed request.");
            return false;
        }

        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode rootNode = mapper.readTree(payload);

            long installationId = rootNode.path("installation").path("id").asLong();
            if (installationId == 0) {
                System.out.println("[Webhook] Skipping event: No installation metadata found.");
                return true;
            }

            String repoFullName = rootNode.path("repository").path("full_name").asText();
            String defaultBranch = rootNode.path("repository").path("default_branch").asText("main");

            System.out.println("[Webhook Received] Event: '" + event + "' for repository: " + repoFullName);

            Optional<RepoSettings> settingsOpt = (repoSettingsRepository != null && repoFullName != null) ?
                    repoSettingsRepository.findById(repoFullName) : Optional.empty();

            if ("workflow_run".equals(event)) {
                String action = rootNode.path("action").asText();
                JsonNode runNode = rootNode.path("workflow_run");
                String conclusion = runNode.path("conclusion").asText();
                String runId = runNode.path("id").asText();
                String headBranch = runNode.path("head_branch").asText(defaultBranch);
                String workflowPath = runNode.path("path").asText("");
                String workflowName = runNode.path("name").asText("");

                System.out.println("[Webhook Workflow] Run ID: " + runId + ", Action: " + action + ", Conclusion: " + conclusion + ", Workflow: " + workflowName);

                if (isPikilandSelfWorkflow(workflowPath, workflowName)) {
                    System.out.println("[Webhook] PikiLand self-healing workflow completion detected. Run ID: " + runId + ", Conclusion: " + conclusion);
                    if ("completed".equals(action) && "failure".equals(conclusion)) {
                        updateFingerprintStateForRepo(repoFullName, "FAILED", null);
                    }
                    return true;
                }

                if ("completed".equals(action) && "failure".equals(conclusion)) {
                    if (settingsOpt.isPresent() && !settingsOpt.get().isActive()) {
                        System.out.println("[Webhook Notice] Repository " + repoFullName + " is INACTIVE in PikiLand. Skipping self-healing.");
                        return true;
                    }
                    System.out.println("[Webhook Action] 🚀 Target Workflow Failure Detected! Run ID: " + runId + ", Repo: " + repoFullName + ", Head Branch: " + headBranch);
                    selfHealingAppService.runSelfHealing(repoFullName, null, "workflow_run", runId, installationId, headBranch, defaultBranch);
                }
            } else if ("pull_request".equals(event)) {
                String action = rootNode.path("action").asText();
                JsonNode prNode = rootNode.path("pull_request");
                String headRef = prNode.path("head").path("ref").asText("");
                String prBody = prNode.path("body").asText("");
                String prUrl = prNode.path("html_url").asText("");
                boolean merged = prNode.path("merged").asBoolean(false);

                if (headRef.startsWith("pikiland/") || prBody.contains("PikiLand Incident Fingerprint:")) {
                    String hash = extractFingerprintHash(headRef, prBody);
                    System.out.println("[Webhook PR] PikiLand Patch PR Event: action=" + action + ", hash=" + hash + ", url=" + prUrl);

                    if ("opened".equals(action)) {
                        updateFingerprintStateByHashOrRepo(hash, repoFullName, "PR_CREATED", prUrl);
                    } else if ("closed".equals(action) && merged) {
                        updateFingerprintStateByHashOrRepo(hash, repoFullName, "RESOLVED", prUrl);
                    }
                }
            } else if ("issues".equals(event)) {
                String action = rootNode.path("action").asText();
                if ("opened".equals(action)) {
                    JsonNode issueNode = rootNode.path("issue");
                    String issueBody = issueNode.path("body").asText();
                    String issueNumber = issueNode.path("number").asText();
                    
                    if (settingsOpt.isPresent() && !settingsOpt.get().isActive()) {
                        System.out.println("[Webhook Notice] Repository " + repoFullName + " is INACTIVE in PikiLand. Skipping issue self-healing.");
                        return true;
                    }
                    System.out.println("[Webhook Action] 🚀 Issue Opened Event Detected! Issue #: " + issueNumber + ", Repo: " + repoFullName);
                    selfHealingAppService.runSelfHealing(repoFullName, issueBody, "issues", issueNumber, installationId, defaultBranch, defaultBranch);
                }
            }
            return true;
        } catch (Exception e) {
            System.err.println("[Webhook] Failed to parse payload: " + e.getMessage());
            return true;
        }
    }

    private boolean isPikilandSelfWorkflow(String workflowPath, String workflowName) {
        if (workflowPath != null && (workflowPath.endsWith("pikiland.yml") || workflowPath.endsWith("pikiland.yaml"))) {
            return true;
        }
        return workflowName != null && workflowName.toLowerCase().contains("pikiland");
    }

    private String extractFingerprintHash(String headRef, String prBody) {
        if (headRef != null && headRef.startsWith("pikiland/fix-")) {
            return headRef.substring("pikiland/fix-".length());
        }
        if (prBody != null && prBody.contains("PikiLand Incident Fingerprint:")) {
            int idx = prBody.indexOf("PikiLand Incident Fingerprint:");
            String sub = prBody.substring(idx + "PikiLand Incident Fingerprint:".length()).trim();
            int end = sub.indexOf("\n");
            return (end != -1) ? sub.substring(0, end).trim() : sub.trim();
        }
        return null;
    }

    private void updateFingerprintStateByHashOrRepo(String hash, String repoFullName, String newState, String prUrl) {
        if (logFingerprintRepository == null) return;
        if (hash != null) {
            Optional<com.yourssu.pikiland.domain.model.LogFingerprint> fpOpt = logFingerprintRepository.findByHash(hash);
            if (fpOpt.isPresent()) {
                com.yourssu.pikiland.domain.model.LogFingerprint fp = fpOpt.get();
                if ("PR_CREATED".equals(newState)) fp.markPrCreated(prUrl);
                else if ("RESOLVED".equals(newState)) fp.markResolved();
                else if ("FAILED".equals(newState)) fp.markFailed();
                logFingerprintRepository.save(fp);
                return;
            }
        }
        updateFingerprintStateForRepo(repoFullName, newState, prUrl);
    }

    private void updateFingerprintStateForRepo(String repoFullName, String newState, String prUrl) {
        if (logFingerprintRepository == null || repoFullName == null) return;
        java.util.List<com.yourssu.pikiland.domain.model.LogFingerprint> list = logFingerprintRepository.findAllByRepository(repoFullName);
        for (com.yourssu.pikiland.domain.model.LogFingerprint fp : list) {
            if (fp.getState() == com.yourssu.pikiland.domain.model.LogFingerprint.State.IN_PROGRESS ||
                fp.getState() == com.yourssu.pikiland.domain.model.LogFingerprint.State.PR_CREATED) {
                if ("PR_CREATED".equals(newState)) fp.markPrCreated(prUrl);
                else if ("RESOLVED".equals(newState)) fp.markResolved();
                else if ("FAILED".equals(newState)) fp.markFailed();
                logFingerprintRepository.save(fp);
            }
        }
    }
}
