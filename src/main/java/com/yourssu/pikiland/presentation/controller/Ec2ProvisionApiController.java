package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.DashboardAppService;
import com.yourssu.pikiland.application.service.Ec2ProvisionService;
import com.yourssu.pikiland.application.service.LogIngestService;
import com.yourssu.pikiland.application.service.LogPathInferenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/settings")
public class Ec2ProvisionApiController {

    private final Ec2ProvisionService ec2ProvisionService;
    private final LogPathInferenceService logPathInferenceService;
    private final LogIngestService logIngestService;
    private final DashboardAppService dashboardAppService;
    private final OAuth2AuthorizedClientService authorizedClientService;

    @Value("${app.log-receiver.token:your_secure_agent_token_here}")
    private String configuredToken;

    @Autowired
    public Ec2ProvisionApiController(Ec2ProvisionService ec2ProvisionService,
                                     LogPathInferenceService logPathInferenceService,
                                     @Autowired(required = false) LogIngestService logIngestService,
                                     @Autowired(required = false) DashboardAppService dashboardAppService,
                                     @Autowired(required = false) OAuth2AuthorizedClientService authorizedClientService) {
        this.ec2ProvisionService = ec2ProvisionService;
        this.logPathInferenceService = logPathInferenceService;
        this.logIngestService = logIngestService;
        this.dashboardAppService = dashboardAppService;
        this.authorizedClientService = authorizedClientService;
    }

    @SuppressWarnings("unused")
    public static class ProvisionRequest {
        public String repositoryFullName;
        public String ec2Ip;
        public String sshUser;
        public String logPath;
        public String pemKey;
        public String pipelineServerHost;
        public Integer pipelineServerPort;
    }

    @GetMapping("/infer-log-path")
    public ResponseEntity<?> inferLogPath(
            @RequestParam(value = "repo", required = false) String repo,
            @AuthenticationPrincipal OAuth2User oauth2User) {

        if (repo == null || repo.isBlank()) {
            String defaultPath = logPathInferenceService.inferLogPath(null, null);
            return ResponseEntity.ok(Map.of("inferredLogPath", defaultPath));
        }

        String userToken = null;
        if (oauth2User != null && authorizedClientService != null) {
            try {
                OAuth2AuthorizedClient client = authorizedClientService.loadAuthorizedClient("github", oauth2User.getName());
                if (client != null && client.getAccessToken() != null) {
                    userToken = client.getAccessToken().getTokenValue();
                }
            } catch (Exception ignored) {}
        }

        List<String> filenames = (dashboardAppService != null) ? dashboardAppService.fetchRemoteRepoFilenames(repo, userToken) : null;
        String configFileContent = (dashboardAppService != null) ? dashboardAppService.fetchConfigFileContent(repo, userToken) : null;

        String inferred = logPathInferenceService.inferLogPath(filenames, configFileContent);
        return ResponseEntity.ok(Map.of("inferredLogPath", inferred));
    }

    @GetMapping("/incidents")
    public ResponseEntity<?> getIncidents(@RequestParam(value = "repo", required = false) String repo) {
        if (logIngestService == null) {
            return ResponseEntity.ok(java.util.List.of());
        }
        if (repo != null && !repo.isBlank()) {
            return ResponseEntity.ok(logIngestService.getIncidentsForRepository(repo));
        }
        return ResponseEntity.ok(java.util.List.of());
    }

    @GetMapping("/incidents/detail")
    public ResponseEntity<?> getIncidentDetail(
            @RequestParam(value = "hash", required = false) String hash,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (logIngestService == null || hash == null || hash.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("status", "error", "message", "Hash parameter missing"));
        }

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("status", "error", "message", "Missing or invalid Authorization header"));
        }

        String token = authHeader.substring(7).trim();
        Map<String, Object> result = logIngestService.getIncidentDetailMapByHash(hash, token);
        if (result == null) {
            return ResponseEntity.notFound().build();
        }
        if ("forbidden".equals(result.get("error"))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("status", "error", "message", "Access denied for incident details"));
        }

        return ResponseEntity.ok(result);
    }

    @PostMapping("/provision-ec2")
    public ResponseEntity<?> provisionEc2(@RequestBody ProvisionRequest req) {
        if (req == null || req.repositoryFullName == null || req.ec2Ip == null || req.sshUser == null || req.pemKey == null) {
            return ResponseEntity.badRequest().body(Map.of("status", "error", "message", "Required parameters missing"));
        }

        try {
            boolean success = ec2ProvisionService.provisionInstance(
                    req.repositoryFullName,
                    req.ec2Ip,
                    req.sshUser,
                    req.logPath,
                    req.pemKey,
                    req.pipelineServerHost,
                    req.pipelineServerPort != null ? req.pipelineServerPort : 8080,
                    configuredToken
            );

            if (success) {
                return ResponseEntity.ok(Map.of("status", "success", "message", "EC2 Fluent Bit provisioned and SSH key revoked successfully"));
            } else {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("status", "error", "message", "Provisioning failed. Check server logs."));
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("status", "error", "message", e.getMessage()));
        }
    }
}
