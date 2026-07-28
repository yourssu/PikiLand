package com.yourssu.pikiland.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.model.SystemSettings;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import com.yourssu.pikiland.domain.port.SystemSettingsRepository;
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

    private final SelfHealingAppService selfHealingAppService;
    private final SystemSettingsRepository systemSettingsRepository;
    private final RepoSettingsRepository repoSettingsRepository;

    @Value("${app.github.webhook-secret:}")
    private String webhookSecret;

    @Value("${app.debug:false}")
    private boolean isDebug;

    public WebhookAppService(SelfHealingAppService selfHealingAppService,
                             SystemSettingsRepository systemSettingsRepository,
                             RepoSettingsRepository repoSettingsRepository) {
        this.selfHealingAppService = selfHealingAppService;
        this.systemSettingsRepository = systemSettingsRepository;
        this.repoSettingsRepository = repoSettingsRepository;
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
                    System.out.println("[Webhook] Skipping self-healing workflow execution to prevent infinite loop. Run ID: " + runId);
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
        if (workflowName != null && workflowName.toLowerCase().contains("pikiland")) {
            return true;
        }
        return false;
    }
}
