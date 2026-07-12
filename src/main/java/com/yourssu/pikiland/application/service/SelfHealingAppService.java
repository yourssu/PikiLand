package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.*;
import com.yourssu.pikiland.domain.service.LogTruncator;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.nio.file.Path;

@Service
public class SelfHealingAppService {

    private final RepoSettingsRepository settingsRepository;
    private final WorkspacePort workspacePort;
    private final AiAgentPort aiAgentPort;
    private final NotifierPort notifierPort;
    private final GithubAuthPort githubAuthPort;
    private final LogTruncator logTruncator;

    public SelfHealingAppService(RepoSettingsRepository settingsRepository,
                                  WorkspacePort workspacePort,
                                  AiAgentPort aiAgentPort,
                                  NotifierPort notifierPort,
                                  GithubAuthPort githubAuthPort,
                                  LogTruncator logTruncator) {
        this.settingsRepository = settingsRepository;
        this.workspacePort = workspacePort;
        this.aiAgentPort = aiAgentPort;
        this.notifierPort = notifierPort;
        this.githubAuthPort = githubAuthPort;
        this.logTruncator = logTruncator;
    }

    @Async
    public void runSelfHealing(String repoName, String rawLogOrIssueBody, String eventType, String runId, long installationId) {
        System.out.println("Starting Self-Healing asynchronously for " + repoName + " on thread: " + Thread.currentThread());
        
        RepoSettings settings = settingsRepository.findById(repoName)
                .orElseGet(() -> new RepoSettings(repoName, false, null, null));

        if (!settings.isActive()) {
            System.out.println("PikiLand is disabled for repo: " + repoName + ". Skipping self-healing.");
            return;
        }

        try {
            // Get installation token
            String token = githubAuthPort.getInstallationAccessToken(installationId);

            // Clone repository to isolated temp workspace
            Path workspace = workspacePort.cloneRepository(repoName, token);

            // Truncate logs if needed
            String logToAnalyze = rawLogOrIssueBody;
            if ("workflow_run".equals(eventType)) {
                System.out.println("Downloading logs for run: " + runId);
                String rawLogs = githubAuthPort.downloadWorkflowLogs(repoName, runId, token);
                logToAnalyze = logTruncator.truncateLogForAi(rawLogs, 300);
            }

            // Run AI Diagnostic Loop
            AiAnalysisResult aiResult = aiAgentPort.analyzeError(
                logToAnalyze, 
                eventType, 
                workspace, 
                workspacePort, 
                settings.getCustomModel()
            );

            String prUrl = null;
            if (aiResult.isConfident() && aiResult.isPrNeeded() && !aiResult.getPatchInstructions().isEmpty()) {
                System.out.println("AI detected fix. Applying patches and creating PR...");
                
                // Apply patches inside temp workspace
                workspacePort.applyPatches(workspace, aiResult.getPatchInstructions());
                
                // Create unique branch name, commit changes and push
                String branchName = "fix/ai-auto-patch-" + System.currentTimeMillis();
                String commitMsg = aiResult.getPrTitle();
                
                workspacePort.commitAndPush(workspace, branchName, commitMsg, token, repoName);
                
                // Submit PR via GitHub App auth REST API
                prUrl = githubAuthPort.createPullRequest(
                    repoName,
                    aiResult.getPrTitle(),
                    aiResult.getPrBody(),
                    branchName,
                    "main",
                    token
                );
            }

            // Slack Notification
            if (settings.getSlackWebhookUrl() != null && !settings.getSlackWebhookUrl().isBlank()) {
                notifierPort.sendNotification(
                    settings.getSlackWebhookUrl(),
                    logToAnalyze,
                    aiResult,
                    eventType,
                    repoName,
                    runId,
                    prUrl
                );
            } else {
                System.out.println("Slack webhook is not set. Diagnostics result:");
                System.out.println("Summary: " + aiResult.getSummary());
                System.out.println("PR: " + (prUrl != null ? prUrl : "Not created"));
            }

        } catch (Exception e) {
            System.err.println("Fatal error in Self-Healing loop for " + repoName + ": " + e.getMessage());
            e.printStackTrace();
        }
    }
}
