package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.DashboardAppService;
import com.yourssu.pikiland.application.service.Ec2ProvisionService;
import com.yourssu.pikiland.application.service.LogIngestService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/settings")
public class Ec2ProvisionApiController {

    private final Ec2ProvisionService ec2ProvisionService;
    private final LogIngestService logIngestService;
    private final DashboardAppService dashboardAppService;
    private final OAuth2AuthorizedClientService authorizedClientService;

    @Value("${app.log-receiver.token:your_secure_agent_token_here}")
    private String configuredToken;

    @Autowired
    public Ec2ProvisionApiController(Ec2ProvisionService ec2ProvisionService,
                                     @Autowired(required = false) LogIngestService logIngestService,
                                     @Autowired(required = false) DashboardAppService dashboardAppService,
                                     @Autowired(required = false) OAuth2AuthorizedClientService authorizedClientService) {
        this.ec2ProvisionService = ec2ProvisionService;
        this.logIngestService = logIngestService;
        this.dashboardAppService = dashboardAppService;
        this.authorizedClientService = authorizedClientService;
    }

    /**
     * POST /api/settings/provision-ec2  (multipart/form-data)
     *
     * Fields:
     *   - repositoryFullName (text)
     *   - ec2Ip              (text)  예: 1.2.3.4 또는 1.2.3.4:22
     *   - sshUser            (text)
     *   - logPath            (text, optional)
     *   - pipelineServerHost (text, optional)
     *   - pipelineServerPort (text, optional)
     *   - pemKey             (file)  SSH 개인 키 파일 (.pem / id_rsa / id_ed25519)
     */
    @PostMapping(value = "/provision-ec2", consumes = "multipart/form-data")
    public ResponseEntity<?> provisionEc2(
            @RequestParam("repositoryFullName") String repositoryFullName,
            @RequestParam("ec2Ip") String ec2Ip,
            @RequestParam("sshUser") String sshUser,
            @RequestParam(value = "logPath", required = false) String logPath,
            @RequestParam(value = "pipelineServerHost", required = false) String pipelineServerHost,
            @RequestParam(value = "pipelineServerPort", required = false) Integer pipelineServerPort,
            @RequestParam("pemKey") MultipartFile pemKeyFile,
            jakarta.servlet.http.HttpServletRequest request) {

        if (repositoryFullName == null || repositoryFullName.isBlank()
                || ec2Ip == null || ec2Ip.isBlank()
                || sshUser == null || sshUser.isBlank()
                || pemKeyFile == null || pemKeyFile.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("status", "error", "message", "Required parameters missing"));
        }

        try {
            String pemKeyContent = new String(pemKeyFile.getBytes(), StandardCharsets.UTF_8);

            // Auto-detect PikiLand server domain/host and port if not specified
            String effectiveHost = pipelineServerHost;
            if (effectiveHost == null || effectiveHost.isBlank()) {
                String forwardedHost = request.getHeader("X-Forwarded-Host");
                if (forwardedHost != null && !forwardedHost.isBlank()) {
                    effectiveHost = forwardedHost.split(",")[0].trim();
                } else {
                    effectiveHost = request.getHeader("Host");
                    if (effectiveHost != null && effectiveHost.contains(":")) {
                        effectiveHost = effectiveHost.split(":")[0];
                    }
                }
                if (effectiveHost == null || effectiveHost.isBlank()) {
                    effectiveHost = request.getServerName();
                }
            }

            String forwardedProto = request.getHeader("X-Forwarded-Proto");
            boolean isHttps = "https".equalsIgnoreCase(forwardedProto) || request.isSecure();
            int effectivePort = (pipelineServerPort != null && pipelineServerPort > 0)
                    ? pipelineServerPort
                    : (isHttps ? 443 : (request.getServerPort() > 0 ? request.getServerPort() : 443));

            boolean success = ec2ProvisionService.provisionInstance(
                    repositoryFullName, ec2Ip, sshUser, logPath, pemKeyContent,
                    effectiveHost, effectivePort, configuredToken);

            if (success) {
                return ResponseEntity.ok(Map.of("status", "success",
                        "message", "EC2 Fluent Bit provisioned and SSH key revoked successfully"));
            } else {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("status", "error", "message", "Provisioning failed. Check server logs."));
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("status", "error", "message", e.getMessage()));
        }
    }

    @GetMapping("/infer-log-path")
    public ResponseEntity<?> inferLogPath(
            @RequestParam(value = "repo", required = false) String repo,
            @AuthenticationPrincipal OAuth2User oauth2User) {
        return ResponseEntity.ok(Map.of("inferredLogPath", "/var/log/app.log"));
    }

    @GetMapping("/incidents")
    public ResponseEntity<?> getIncidents(@RequestParam(value = "repo", required = false) String repo) {
        if (logIngestService == null) return ResponseEntity.ok(List.of());
        if (repo != null && !repo.isBlank()) {
            return ResponseEntity.ok(logIngestService.getIncidentsForRepository(repo));
        }
        return ResponseEntity.ok(List.of());
    }

    @GetMapping("/incidents/detail")
    public ResponseEntity<?> getIncidentDetail(
            @RequestParam(value = "hash", required = false) String hash,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {

        if (logIngestService == null || hash == null || hash.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("status", "error", "message", "Hash parameter missing"));
        }
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("status", "error", "message", "Missing or invalid Authorization header"));
        }

        String token = authHeader.substring(7).trim();
        Map<String, Object> result = logIngestService.getIncidentDetailMapByHash(hash, token);
        if (result == null) return ResponseEntity.notFound().build();
        if ("forbidden".equals(result.get("error"))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("status", "error", "message", "Access denied for incident details"));
        }
        return ResponseEntity.ok(result);
    }
}
