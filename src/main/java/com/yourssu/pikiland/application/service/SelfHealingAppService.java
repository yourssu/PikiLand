package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.PrCandidate;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.*;
import com.yourssu.pikiland.domain.service.LogTruncator;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import java.util.HashMap;
import java.util.Map;

@Service
public class SelfHealingAppService {

    private final RepoSettingsRepository settingsRepository;
    private final GithubAuthPort githubAuthPort;
    private final LogTruncator logTruncator;

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
                .orElseGet(() -> new RepoSettings(repoName, false, null, null, null));

        if (!settings.isActive()) {
            System.out.println("PikiLand is disabled for repo: " + repoName + ". Skipping self-healing trigger.");
            return;
        }

        try {
            // Get installation token
            String token = githubAuthPort.getInstallationAccessToken(installationId);

            // Truncate logs if needed
            String logToAnalyze = rawLogOrIssueBody;
            if ("workflow_run".equals(eventType)) {
                System.out.println("Downloading logs for run: " + runId);
                String rawLogs = githubAuthPort.downloadWorkflowLogs(repoName, runId, token);
                logToAnalyze = logTruncator.truncateLogForAi(rawLogs, 300);
            }

            // Ensure the workflow file is installed on the default branch
            System.out.println("Ensuring PikiLand workflow is installed on branch: " + defaultBranch);
            githubAuthPort.installWorkflowIfMissing(repoName, token, defaultBranch);

            // Build inputs for workflow dispatch
            Map<String, Object> inputs = new HashMap<>();
            inputs.put("event_type", eventType);
            inputs.put("log_content", logToAnalyze != null ? logToAnalyze : "");
            inputs.put("run_id", runId != null ? runId : "");
            inputs.put("target_branch", targetBranch != null ? targetBranch : defaultBranch);
            inputs.put("slack_webhook_url", settings.getSlackWebhookUrl() != null ? settings.getSlackWebhookUrl() : "");
            inputs.put("ai_model", settings.getCustomModel() != null ? settings.getCustomModel() : "");
            inputs.put("ai_base_url", settings.getCustomBaseUrl() != null ? settings.getCustomBaseUrl() : "");
            inputs.put("harness_cmd", settings.getHarnessCmd() != null ? settings.getHarnessCmd() : "");
            inputs.put("ralph_max_retries", String.valueOf(settings.getRalphMaxRetries() > 0 ? settings.getRalphMaxRetries() : 3));


            // Trigger workflow dispatch on the default branch (where pikiland.yml exists)
            System.out.println("Triggering workflow dispatch 'pikiland.yml' on ref: " + defaultBranch + " with target_branch: " + targetBranch);
            githubAuthPort.triggerWorkflowDispatch(repoName, "pikiland.yml", defaultBranch, inputs, token);

        } catch (Exception e) {
            System.err.println("Fatal error triggering workflow dispatch for " + repoName + ": " + e.getMessage());
            e.printStackTrace();
        }
    }
}
