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

        // Declared outside try so the finally block can always clean up, even on mid-flow failure
        Path workspace = null;
        try {
            // Get installation token
            String token = githubAuthPort.getInstallationAccessToken(installationId);

            // Clone repository to isolated temp workspace
            workspace = workspacePort.cloneRepository(repoName, token);

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

            List<String> prUrls = new ArrayList<>();
            if (aiResult.isPrNeeded() && aiResult.getPrCandidates() != null && !aiResult.getPrCandidates().isEmpty()) {
                System.out.println("AI requested PR. Total candidates: " + aiResult.getPrCandidates().size());
                
                String baseBranch = workspacePort.getCurrentBranch(workspace);
                System.out.println("Current workspace base branch: " + baseBranch);
                
                for (int i = 0; i < aiResult.getPrCandidates().size(); i++) {
                    PrCandidate candidate = aiResult.getPrCandidates().get(i);
                    if (candidate.getPatchInstructions() == null || candidate.getPatchInstructions().isEmpty()) {
                        System.out.println("Candidate " + (i + 1) + " has empty patch instructions. Skipping.");
                        continue;
                    }
                    
                    System.out.println("Applying patches for candidate " + (i + 1) + "...");
                    try {
                        // Reset workspace to original base branch and discard previous patches
                        workspacePort.resetToCleanState(workspace, baseBranch);
                        
                        // Apply candidate patches
                        workspacePort.applyPatches(workspace, candidate.getPatchInstructions());
                        
                        // Create unique branch name
                        String branchName = "fix/ai-candidate-" + (i + 1) + "-" + System.currentTimeMillis();
                        String commitMsg = candidate.getPrTitle();
                        
                        workspacePort.commitAndPush(workspace, branchName, commitMsg, token, repoName);
                        
                        // Submit PR via GitHub App auth REST API targeting baseBranch
                        String detailedPrBody = candidate.getPrBody() != null ? candidate.getPrBody() : "";
                        if (logToAnalyze != null && !logToAnalyze.isBlank()) {
                            detailedPrBody += "\n\n---\n\n<details>\n<summary>🔍 원본 에러 로그 및 발생 Context 보기</summary>\n\n```\n" + logToAnalyze + "\n```\n</details>";
                        }

                        String prUrl = githubAuthPort.createPullRequest(
                            repoName,
                            candidate.getPrTitle(),
                            detailedPrBody,
                            branchName,
                            baseBranch,
                            token
                        );
                        
                        if (prUrl != null) {
                            prUrls.add(prUrl);
                            System.out.println("Created PR for candidate " + (i + 1) + ": " + prUrl);
                        }
                    } catch (Exception ex) {
                        System.err.println("Failed to create PR for candidate " + (i + 1) + ": " + ex.getMessage());
                        ex.printStackTrace();
                    }
                }
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
                    prUrls
                );
            } else {
                System.out.println("Slack webhook is not set. Diagnostics result:");
                System.out.println("Summary: " + aiResult.getSummary());
                System.out.println("PR Candidates created: " + prUrls);
            }

        } catch (Exception e) {
            System.err.println("Fatal error in Self-Healing loop for " + repoName + ": " + e.getMessage());
            e.printStackTrace();
            // Alert the team via Slack so pipeline failures don't go unnoticed
            if (settings.getSlackWebhookUrl() != null && !settings.getSlackWebhookUrl().isBlank()) {
                notifierPort.sendErrorNotification(
                        settings.getSlackWebhookUrl(),
                        repoName,
                        e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()
                );
            }
        } finally {
            // Always reclaim the temp workspace to prevent disk accumulation
            if (workspace != null) {
                System.out.println("[SelfHealing] Cleaning up temp workspace for: " + repoName);
                workspacePort.deleteWorkspace(workspace);
            }
        }
    }
}
