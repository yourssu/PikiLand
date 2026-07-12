package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.port.GithubAuthPort;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

@Service
public class WebhookAppService {

    private final SelfHealingAppService selfHealingAppService;
    private final GithubAuthPort githubAuthPort;

    public WebhookAppService(SelfHealingAppService selfHealingAppService, GithubAuthPort githubAuthPort) {
        this.selfHealingAppService = selfHealingAppService;
        this.githubAuthPort = githubAuthPort;
    }

    public void handleEvent(String event, String payload, String signature) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode rootNode = mapper.readTree(payload);

            long installationId = rootNode.path("installation").path("id").asLong();
            if (installationId == 0) {
                System.out.println("Skipping webhook event: No installation metadata found.");
                return;
            }

            String repoFullName = rootNode.path("repository").path("full_name").asText();

            if ("workflow_run".equals(event)) {
                String action = rootNode.path("action").asText();
                JsonNode runNode = rootNode.path("workflow_run");
                String conclusion = runNode.path("conclusion").asText();
                String runId = runNode.path("id").asText();

                if ("completed".equals(action) && "failure".equals(conclusion)) {
                    System.out.println("Webhook: Workflow Run Failed event detected for Run ID: " + runId);
                    
                    // We run async task but download logs inside async worker, so we pass installationId
                    // To do it cleanly, we can pass a dummy log if we fail to fetch logs
                    // Let us extract logs inside the worker. But wait, to keep selfHealingAppService clean,
                    // we can pass the runId and fetch the logs inside the Virtual Thread.
                    // This prevents blocking the webhook response!
                    
                    // SelfHealingAppService accepts rawLogOrIssueBody. We can modify it to fetch logs in background.
                    // Let us pass empty string and let SelfHealingAppService fetch logs inside async runner.
                    // Let us modify the signature of runSelfHealing to accept runId and download log inside it.
                    selfHealingAppService.runSelfHealing(repoFullName, null, "workflow_run", runId, installationId);
                }
            } else if ("issues".equals(event)) {
                String action = rootNode.path("action").asText();
                if ("opened".equals(action)) {
                    JsonNode issueNode = rootNode.path("issue");
                    String issueBody = issueNode.path("body").asText();
                    String issueNumber = issueNode.path("number").asText();
                    
                    System.out.println("Webhook: Issue Opened event detected for issue number: " + issueNumber);
                    selfHealingAppService.runSelfHealing(repoFullName, issueBody, "issues", issueNumber, installationId);
                }
            }
        } catch (Exception e) {
            System.err.println("Failed to parse webhook payload: " + e.getMessage());
        }
    }
}
