package com.yourssu.pikiland.application.service;

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
    private final RestTemplate restTemplate;

    public DashboardAppService(RepoSettingsRepository repoSettingsRepository) {
        this.repoSettingsRepository = repoSettingsRepository;
        this.restTemplate = new RestTemplate();
    }

    public List<RepoSettingsDto> getUserRepositories(String accessToken) {
        List<RepoSettingsDto> repos = new ArrayList<>();
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + accessToken);
            headers.set("Accept", "application/vnd.github+json");
            
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            String url = "https://api.github.com/user/repos?per_page=100";
            
            ResponseEntity<List<Map<String, Object>>> response = restTemplate.exchange(
                    url,
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
                            repos.add(new RepoSettingsDto(s.getRepositoryFullName(), s.isActive(), s.getSlackWebhookUrl(), s.getCustomModel()));
                        } else {
                            repos.add(new RepoSettingsDto(fullName, false, "", ""));
                        }
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("Failed to fetch user repositories from GitHub: " + e.getMessage());
        }
        return repos;
    }

    public void updateRepoSettings(RepoSettingsDto dto) {
        RepoSettings settings = new RepoSettings(dto.getFullName(), dto.isActive(), dto.getSlackWebhookUrl(), dto.getCustomModel());
        repoSettingsRepository.save(settings);
    }
}
