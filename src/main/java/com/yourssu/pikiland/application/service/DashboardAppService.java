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
    private final RestTemplate restTemplate;

    public DashboardAppService(RepoSettingsRepository repoSettingsRepository,
                               SystemSettingsRepository systemSettingsRepository,
                               HarnessInferenceService harnessInferenceService) {
        this.repoSettingsRepository = repoSettingsRepository;
        this.systemSettingsRepository = systemSettingsRepository;
        this.harnessInferenceService = harnessInferenceService;
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
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + accessToken);
            headers.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> entity = new HttpEntity<>(headers);

            String nextUrl = "https://api.github.com/user/repos?per_page=100&page=1";
            int pageCount = 0;
            while (nextUrl != null) {
                pageCount++;
                if (pageCount > 250) {
                    System.err.println("[DashboardAppService] Aborting pagination: exceeded 250 pages.");
                    break;
                }
                ResponseEntity<List<Map<String, Object>>> response = restTemplate.exchange(
                        nextUrl,
                        HttpMethod.GET,
                        entity,
                        new ParameterizedTypeReference<List<Map<String, Object>>>() {}
                );

                if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                    for (Map<String, Object> repoData : response.getBody()) {
                        String fullName = (String) repoData.get("full_name");
                        if (fullName != null) {
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
                                        s.getRalphMaxRetries()
                                ));
                            } else {
                                repos.add(new RepoSettingsDto(fullName, false, "", "", "", "", "", "NONE", "NONE", 3));
                            }
                        }
                    }
                    nextUrl = parseNextUrl(response.getHeaders().getFirst("Link"));
                } else {
                    break;
                }
            }
        } catch (Exception e) {
            System.err.println("Failed to fetch user repositories from GitHub: " + e.getMessage());
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

    public void updateRepoSettings(RepoSettingsDto dto) {
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
        String defaultCmd = "./gradlew test";
        RepoSettings settings = repoSettingsRepository.findById(fullName)
                .orElseGet(() -> new RepoSettings(fullName, false, "", "", ""));
        settings.setInferredHarness(defaultCmd, HarnessSource.AUTO_INFERRED);
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
}

