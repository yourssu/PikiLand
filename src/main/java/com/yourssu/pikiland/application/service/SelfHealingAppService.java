package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.*;
import com.yourssu.pikiland.domain.service.LogTruncator;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class SelfHealingAppService {

    private final RepoSettingsRepository settingsRepository;
    private final GithubAuthPort githubAuthPort;
    private final LogTruncator logTruncator;

    @Value("${app.server-url:}")
    private String serverUrl;

    public SelfHealingAppService(RepoSettingsRepository settingsRepository,
                                  GithubAuthPort githubAuthPort,
                                  LogTruncator logTruncator) {
        this.settingsRepository = settingsRepository;
        this.githubAuthPort = githubAuthPort;
        this.logTruncator = logTruncator;
    }

    @Async
    public void runSelfHealing(String repoName, String rawLogOrIssueBody, String eventType, String runId, long installationId, String targetBranch, String defaultBranch) {
        System.out.println("Starting Self-Healing Trigger asynchronously for " + repoName + " on thread: " + Thread.currentThread());

        RepoSettings settings = settingsRepository.findById(repoName)
                .orElseGet(() -> new RepoSettings(repoName, true, null, null, null));

        if (!settings.isActive()) {
            System.out.println("PikiLand is disabled for repo: " + repoName + ". Skipping self-healing trigger.");
            return;
        }

        try {
            // Get installation token (fallback to repo lookup if installationId is 0)
            String token = (installationId > 0)
                    ? githubAuthPort.getInstallationAccessToken(installationId)
                    : githubAuthPort.getInstallationAccessTokenForRepo(repoName);

            if (token == null || token.isBlank()) {
                System.err.println("[SelfHealing] Could not acquire Installation Access Token for repo: " + repoName + ". Ensure PikiLand GitHub App is installed on this repository.");
                return;
            }

            // Ensure the workflow file is installed on the default branch
            System.out.println("Ensuring PikiLand workflow is installed on branch: " + defaultBranch);
            githubAuthPort.installWorkflowIfMissing(repoName, token, defaultBranch);

            String truncatedLog = "";
            if (rawLogOrIssueBody != null && !rawLogOrIssueBody.isBlank()) {
                truncatedLog = rawLogOrIssueBody.length() > 800
                        ? rawLogOrIssueBody.substring(0, 800) + "\n...[truncated for workflow dispatch]"
                        : rawLogOrIssueBody;
            }

            // Build inputs for workflow dispatch safely within GitHub 1000-char input limits.
            // For production_log, log_content is kept empty so the CLI Engine dynamically fetches the 100% full raw log via API.
            Map<String, Object> inputs = new HashMap<>();
            inputs.put("event_type", eventType);
            inputs.put("log_content", "production_log".equals(eventType) ? "" : truncatedLog);
            inputs.put("run_id", runId != null ? runId : "");
            inputs.put("target_branch", targetBranch != null ? targetBranch : defaultBranch);
            inputs.put("slack_webhook_url", settings.getSlackWebhookUrl() != null ? settings.getSlackWebhookUrl() : "");
            inputs.put("ai_model", settings.getCustomModel() != null ? settings.getCustomModel() : "");
            inputs.put("ai_base_url", settings.getCustomBaseUrl() != null ? settings.getCustomBaseUrl() : "");
            String effectiveHarnessCmd = (settings.getHarnessCmd() != null && !settings.getHarnessCmd().isBlank())
                    ? settings.getHarnessCmd()
                    : (settings.getInferredHarnessCmd() != null ? settings.getInferredHarnessCmd() : "");
            inputs.put("harness_cmd", effectiveHarnessCmd);
            inputs.put("ralph_max_retries", String.valueOf(settings.getRalphMaxRetries() > 0 ? settings.getRalphMaxRetries() : 3));
            inputs.put("pikiland_server_url", serverUrl != null ? serverUrl : "");


            // Trigger workflow dispatch on the default branch (where pikiland.yml exists)
            System.out.println("Triggering workflow dispatch 'pikiland.yml' on ref: " + defaultBranch + " with target_branch: " + targetBranch);
            githubAuthPort.triggerWorkflowDispatch(repoName, "pikiland.yml", defaultBranch, inputs, token);

        } catch (Exception e) {
            System.err.println("Fatal error triggering workflow dispatch for " + repoName + ": " + e.getMessage());
            e.printStackTrace();
        }
    }
}
