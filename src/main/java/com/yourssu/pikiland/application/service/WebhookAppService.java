package com.yourssu.pikiland.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

@Service
public class WebhookAppService {

    private final SelfHealingAppService selfHealingAppService;

    @Value("${app.github.webhook-secret:}")
    private String webhookSecret;

    @Value("${app.debug:false}")
    private boolean isDebug;

    public WebhookAppService(SelfHealingAppService selfHealingAppService) {
        this.selfHealingAppService = selfHealingAppService;
    }

    /**
     * Verifies the GitHub webhook HMAC-SHA256 signature.
     * Verification is skipped when:
     * - {@code app.debug} is true (debug mode)
     *
     * @return true if the request is trusted, false if signature mismatch
     */
    private boolean isTrustedRequest(String payload, String signature) {
        if (isDebug) {
            System.out.println("[Webhook] Signature verification SKIPPED (debug mode)");
            return true;
        }
        if (webhookSecret == null || webhookSecret.isBlank()) {
            System.err.println("[Webhook] REJECTED — GITHUB_WEBHOOK_SECRET is not configured in a " +
                    "production environment. Refusing to trust unsigned requests.");
            return false;
        }

        if (signature == null || !signature.startsWith("sha256=")) {
            System.err.println("[Webhook] Missing or malformed X-Hub-Signature-256 header.");
            return false;
        }

        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] hash = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            String expected = "sha256=" + HexFormat.of().formatHex(hash);

            // Constant-time comparison to prevent timing-attack side-channels
            return MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.UTF_8),
                    signature.getBytes(StandardCharsets.UTF_8)
            );
        } catch (Exception e) {
            System.err.println("[Webhook] Signature computation error: " + e.getMessage());
            return false;
        }
    }

    public void handleEvent(String event, String payload, String signature) {
        // --- Security Gate: reject requests that fail signature verification ---
        if (!isTrustedRequest(payload, signature)) {
            System.err.println("[Webhook] REJECTED — signature verification failed. Possible spoofed request.");
            return;
        }

        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode rootNode = mapper.readTree(payload);

            long installationId = rootNode.path("installation").path("id").asLong();
            if (installationId == 0) {
                System.out.println("Skipping webhook event: No installation metadata found.");
                return;
            }

            String repoFullName = rootNode.path("repository").path("full_name").asText();
            String defaultBranch = rootNode.path("repository").path("default_branch").asText("main");

            if ("workflow_run".equals(event)) {
                String action = rootNode.path("action").asText();
                JsonNode runNode = rootNode.path("workflow_run");
                String conclusion = runNode.path("conclusion").asText();
                String runId = runNode.path("id").asText();
                String headBranch = runNode.path("head_branch").asText(defaultBranch);

                if ("completed".equals(action) && "failure".equals(conclusion)) {
                    System.out.println("Webhook: Workflow Run Failed event detected for Run ID: " + runId + ", head branch: " + headBranch);
                    selfHealingAppService.runSelfHealing(repoFullName, null, "workflow_run", runId, installationId, headBranch, defaultBranch);
                }
            } else if ("issues".equals(event)) {
                String action = rootNode.path("action").asText();
                if ("opened".equals(action)) {
                    JsonNode issueNode = rootNode.path("issue");
                    String issueBody = issueNode.path("body").asText();
                    String issueNumber = issueNode.path("number").asText();
                    
                    System.out.println("Webhook: Issue Opened event detected for issue number: " + issueNumber);
                    selfHealingAppService.runSelfHealing(repoFullName, issueBody, "issues", issueNumber, installationId, defaultBranch, defaultBranch);
                }
            }
        } catch (Exception e) {
            System.err.println("Failed to parse webhook payload: " + e.getMessage());
        }
    }
}
