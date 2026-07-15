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
        org.springframework.http.client.SimpleClientHttpRequestFactory factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(60000);
        this.restTemplate = new RestTemplate(factory);
    }

    public List<RepoSettingsDto> getUserRepositories(String accessToken) {
        List<RepoSettingsDto> repos = new ArrayList<>();
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + accessToken);
            headers.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> entity = new HttpEntity<>(headers);

            // GitHub paginates at 100 per page; follow Link: rel="next" until exhausted
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
                                repos.add(new RepoSettingsDto(s.getRepositoryFullName(), s.isActive(), s.getSlackWebhookUrl(), s.getCustomModel(), s.getHarnessCmd()));
                            } else {
                                repos.add(new RepoSettingsDto(fullName, false, "", "", ""));
                            }
                        }
                    }
                    // Advance to the next page (null if we're on the last page)
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

    /**
     * Parses GitHub's RFC 5988 Link header and returns the URL for {@code rel="next"}.
     * Example header: {@code <https://api.github.com/user/repos?page=2>; rel="next", <...>; rel="last"}
     *
     * @return the next-page URL, or {@code null} when the current page is the last one
     */
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
        RepoSettings settings = new RepoSettings(dto.getFullName(), dto.isActive(), dto.getSlackWebhookUrl(), dto.getCustomModel(), dto.getHarnessCmd());
        repoSettingsRepository.save(settings);
    }

}
