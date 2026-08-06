package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.application.dto.SystemSettingsDto;
import com.yourssu.pikiland.domain.model.SystemSettings;
import com.yourssu.pikiland.domain.port.SystemSettingsRepository;
import com.yourssu.pikiland.domain.model.HarnessSource;
import com.yourssu.pikiland.domain.model.HarnessStatus;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import com.yourssu.pikiland.application.dto.RepoSettingsDto;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class DashboardAppService {

    private final RepoSettingsRepository repoSettingsRepository;
    private final SystemSettingsRepository systemSettingsRepository;
    private final HarnessInferenceService harnessInferenceService;
    private final com.yourssu.pikiland.domain.port.GithubAuthPort githubAuthPort;
    private final RestTemplate restTemplate;

    public DashboardAppService(RepoSettingsRepository repoSettingsRepository,
                               SystemSettingsRepository systemSettingsRepository,
                               HarnessInferenceService harnessInferenceService,
                               com.yourssu.pikiland.domain.port.GithubAuthPort githubAuthPort) {
        this.repoSettingsRepository = repoSettingsRepository;
        this.systemSettingsRepository = systemSettingsRepository;
        this.harnessInferenceService = harnessInferenceService;
        this.githubAuthPort = githubAuthPort;
        org.springframework.http.client.SimpleClientHttpRequestFactory factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(60000);
        this.restTemplate = new RestTemplate(factory);
    }

    public SystemSettingsDto getSystemSettings() {
        SystemSettings s = systemSettingsRepository.findGlobalSettings()
                .orElseGet(() -> new SystemSettings("", "", "", "", ""));
        return new SystemSettingsDto(
                s.getGithubAppId(),
                s.getGithubPrivateKeyContent(),
                s.getGithubWebhookSecret(),
                s.getGithubClientId(),
                s.getGithubClientSecret()
        );
    }

    public void updateSystemSettings(SystemSettingsDto dto) {
        SystemSettings s = new SystemSettings(
                dto.getGithubAppId(),
                dto.getGithubPrivateKeyContent(),
                dto.getGithubWebhookSecret(),
                dto.getGithubClientId(),
                dto.getGithubClientSecret()
        );
        systemSettingsRepository.saveGlobalSettings(s);
    }

    public List<RepoSettingsDto> getUserRepositories(String accessToken) {
        List<RepoSettingsDto> repos = new ArrayList<>();
        try {
            java.util.Set<String> installedRepos = (githubAuthPort != null) ? 
                    githubAuthPort.getInstalledRepositoryFullNames(accessToken) : java.util.Collections.emptySet();

            for (String fullName : installedRepos) {
                Optional<RepoSettings> settingsOpt = repoSettingsRepository.findById(fullName);
                if (settingsOpt.isPresent()) {
                    RepoSettings s = settingsOpt.get();
                    repos.add(new RepoSettingsDto(
                            s.getRepositoryFullName(),
                            s.isActive(),
                            s.getSlackWebhookUrl(),
                            s.getCustomModel(),
                            s.getCustomBaseUrl(),
                            s.getHarnessCmd(),
                            s.getInferredHarnessCmd(),
                            s.getHarnessStatus().name(),
                            s.getHarnessSource().name(),
                            s.getRalphMaxRetries(),
                            true
                    ));
                } else {
                    repos.add(new RepoSettingsDto(fullName, false, "", "", "", "", "", "NONE", "NONE", 3, true));
                }
            }
        } catch (Exception e) {
            System.err.println("Failed to fetch installed repositories: " + e.getMessage());
        }
        return repos;
    }

    private String parseNextUrl(String linkHeader) {
        if (linkHeader == null || linkHeader.isBlank()) return null;
        for (String part : linkHeader.split(",")) {
            part = part.trim();
            if (part.endsWith("; rel=\"next\"")) {
                int start = part.indexOf('<');
                int end = part.indexOf('>');
                if (start != -1 && end > start) {
                    return part.substring(start + 1, end);
                }
            }
        }
        return null;
    }

    public RepoSettingsDto updateRepoSettings(RepoSettingsDto dto) {
        return updateRepoSettings(dto, null);
    }

    public RepoSettingsDto updateRepoSettings(RepoSettingsDto dto, String accessToken) {
        Optional<RepoSettings> existing = repoSettingsRepository.findById(dto.getFullName());
        RepoSettings settings;
        if (existing.isPresent()) {
            settings = existing.get();
            settings.toggleActive(dto.isActive());
            settings.configureSlack(dto.getSlackWebhookUrl());
            settings.configureCustomModel(dto.getCustomModel());
            settings.configureCustomBaseUrl(dto.getCustomBaseUrl());
            if (dto.getHarnessCmd() != null && !dto.getHarnessCmd().isBlank()) {
                settings.configureHarnessCmd(dto.getHarnessCmd());
            }
            if (dto.getRalphMaxRetries() > 0) {
                settings.configureRalphMaxRetries(dto.getRalphMaxRetries());
            }
        } else {
            HarnessStatus status = (dto.getHarnessCmd() != null && !dto.getHarnessCmd().isBlank()) ? HarnessStatus.ACTIVE : HarnessStatus.NONE;
            HarnessSource source = (dto.getHarnessCmd() != null && !dto.getHarnessCmd().isBlank()) ? HarnessSource.USER_PROVIDED : HarnessSource.NONE;
            settings = new RepoSettings(
                    dto.getFullName(),
                    dto.isActive(),
                    dto.getSlackWebhookUrl(),
                    dto.getCustomModel(),
                    dto.getCustomBaseUrl(),
                    dto.getHarnessCmd(),
                    dto.getInferredHarnessCmd(),
                    status,
                    source,
                    dto.getRalphMaxRetries() > 0 ? dto.getRalphMaxRetries() : 3
            );
        }
        repoSettingsRepository.save(settings);

        // Auto-infer test command if active and no harnessCmd configured yet
        if (settings.isActive() && (settings.getHarnessCmd() == null || settings.getHarnessCmd().isBlank())) {
            return reInferHarness(settings.getRepositoryFullName(), accessToken);
        }

        boolean hasAppInstalled = githubAuthPort != null && githubAuthPort.isAppInstalledForRepo(dto.getFullName());
        return new RepoSettingsDto(
                settings.getRepositoryFullName(),
                settings.isActive(),
                settings.getSlackWebhookUrl(),
                settings.getCustomModel(),
                settings.getCustomBaseUrl(),
                settings.getHarnessCmd(),
                settings.getInferredHarnessCmd(),
                settings.getHarnessStatus().name(),
                settings.getHarnessSource().name(),
                settings.getRalphMaxRetries(),
                hasAppInstalled
        );
    }

    public RepoSettingsDto approveInferredHarness(String fullName) {
        RepoSettings settings = repoSettingsRepository.findById(fullName)
                .orElseThrow(() -> new IllegalArgumentException("Repository settings not found for: " + fullName));
        settings.approveInferredHarness();
        repoSettingsRepository.save(settings);
        return new RepoSettingsDto(
                settings.getRepositoryFullName(),
                settings.isActive(),
                settings.getSlackWebhookUrl(),
                settings.getCustomModel(),
                settings.getCustomBaseUrl(),
                settings.getHarnessCmd(),
                settings.getInferredHarnessCmd(),
                settings.getHarnessStatus().name(),
                settings.getHarnessSource().name(),
                settings.getRalphMaxRetries()
        );
    }

    public RepoSettingsDto reInferHarness(String fullName) {
        return reInferHarness(fullName, null);
    }

    public RepoSettingsDto reInferHarness(String fullName, String accessToken) {
        List<String> filenames = fetchRemoteRepoFilenames(fullName, accessToken);
        String inferredCmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);

        RepoSettings settings = repoSettingsRepository.findById(fullName)
                .orElseGet(() -> new RepoSettings(fullName, false, "", "", ""));
        
        String inferenceMsg = null;
        if (inferredCmd != null && !inferredCmd.isBlank()) {
            settings.setInferredHarness(inferredCmd, HarnessSource.AUTO_INFERRED);
        } else {
            settings.setInferredHarness(null, HarnessSource.NONE);
            boolean hasAiKey = System.getenv("OPENAI_API_KEY") != null || System.getenv("ANTHROPIC_API_KEY") != null;
            boolean hasBaseUrl = settings.getCustomBaseUrl() != null && !settings.getCustomBaseUrl().isBlank();
            if (!hasAiKey || !hasBaseUrl) {
                inferenceMsg = "⚠️ Static file inference failed. AI API Key or Custom Base URL is missing, so LLM inference was skipped (Static-only executed).";
            } else {
                inferenceMsg = "⚠️ Could not infer test command from static repository files or LLM analysis.";
            }
        }
        repoSettingsRepository.save(settings);

        boolean hasAppInstalled = githubAuthPort != null && githubAuthPort.isAppInstalledForRepo(fullName);
        RepoSettingsDto dto = new RepoSettingsDto(
                settings.getRepositoryFullName(),
                settings.isActive(),
                settings.getSlackWebhookUrl(),
                settings.getCustomModel(),
                settings.getCustomBaseUrl(),
                settings.getHarnessCmd(),
                settings.getInferredHarnessCmd(),
                settings.getHarnessStatus().name(),
                settings.getHarnessSource().name(),
                settings.getRalphMaxRetries(),
                hasAppInstalled
        );
        dto.setInferenceMessage(inferenceMsg);
        return dto;
    }

    public List<String> fetchRemoteRepoFilenames(String repoFullName, String accessToken) {
        List<String> filenames = new ArrayList<>();
        if (repoFullName == null || !repoFullName.contains("/")) {
            return filenames;
        }

        String effectiveToken = accessToken;
        if (effectiveToken == null || effectiveToken.isBlank()) {
            if (githubAuthPort != null) {
                effectiveToken = githubAuthPort.getInstallationAccessTokenForRepo(repoFullName);
            }
        }

        if (effectiveToken == null || effectiveToken.isBlank()) {
            System.err.println("[DashboardAppService] No OAuth or App token available to fetch contents for " + repoFullName);
            return filenames;
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + effectiveToken);
            headers.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            String url = "https://api.github.com/repos/" + repoFullName + "/contents";
            ResponseEntity<List<Map<String, Object>>> response = restTemplate.exchange(
                    url, HttpMethod.GET, entity, new ParameterizedTypeReference<List<Map<String, Object>>>() {}
            );
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                for (Map<String, Object> item : response.getBody()) {
                    String name = (String) item.get("name");
                    if (name != null) {
                        filenames.add(name);
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("[DashboardAppService] Failed to fetch contents for " + repoFullName + ": " + e.getMessage());
        }
        return filenames;
    }

    public boolean hasUserAdminOrPushPermission(String accessToken, String repoFullName) {
        if (accessToken == null || accessToken.isBlank() || repoFullName == null || !repoFullName.contains("/")) {
            return false;
        }
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + accessToken);
            headers.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            String url = "https://api.github.com/repos/" + repoFullName;
            ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
                    url, HttpMethod.GET, entity, new ParameterizedTypeReference<Map<String, Object>>() {}
            );
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Map<String, Object> permissions = (Map<String, Object>) response.getBody().get("permissions");
                if (permissions != null) {
                    Boolean admin = (Boolean) permissions.get("admin");
                    Boolean push = (Boolean) permissions.get("push");
                    return Boolean.TRUE.equals(admin) || Boolean.TRUE.equals(push);
                }
            }
        } catch (Exception e) {
            System.err.println("[DashboardAppService] Failed to check permissions for " + repoFullName + ": " + e.getMessage());
        }
        return false;
    }
}

