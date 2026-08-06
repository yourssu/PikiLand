package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.Ec2ProvisionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/settings")
public class Ec2ProvisionApiController {

    private final Ec2ProvisionService ec2ProvisionService;
    private final com.yourssu.pikiland.application.service.LogPathInferenceService logPathInferenceService;
    private final com.yourssu.pikiland.application.service.LogIngestService logIngestService;

    @Value("${app.log-receiver.token:your_secure_agent_token_here}")
    private String configuredToken;

    public Ec2ProvisionApiController(Ec2ProvisionService ec2ProvisionService,
                                     com.yourssu.pikiland.application.service.LogPathInferenceService logPathInferenceService,
                                     @org.springframework.beans.factory.annotation.Autowired(required = false) com.yourssu.pikiland.application.service.LogIngestService logIngestService) {
        this.ec2ProvisionService = ec2ProvisionService;
        this.logPathInferenceService = logPathInferenceService;
        this.logIngestService = logIngestService;
    }

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
    public ResponseEntity<?> inferLogPath(@RequestParam(value = "repo", required = false) String repo) {
        String inferred = logPathInferenceService.inferLogPath(null, null);
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
