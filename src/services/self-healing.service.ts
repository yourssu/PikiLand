import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";
import { systemSettingsRepository } from "../db/repositories/system-settings.repository";
import { githubAuthService } from "./github-auth.service";
import { LogTruncator } from "../domain/log-truncator";

export class SelfHealingService {
  private formatServerUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      return `https://${trimmed}`;
    }
    if (trimmed.startsWith("http://") && !trimmed.includes("localhost") && !trimmed.includes("127.0.0.1")) {
      return trimmed.replace("http://", "https://");
    }
    return trimmed;
  }

  private getEffectiveServerUrl(): string {
    const envUrl = process.env.PIKILAND_SERVER_URL;
    if (envUrl && envUrl.trim().length > 0) {
      return this.formatServerUrl(envUrl);
    }
    const globalSettings = systemSettingsRepository.getGlobalSettings();
    if (globalSettings?.pikilandServerUrl && globalSettings.pikilandServerUrl.trim().length > 0) {
      return this.formatServerUrl(globalSettings.pikilandServerUrl);
    }
    return "https://pikiland.yourssu.com";
  }

  public async runSelfHealing(params: {
    repoName: string;
    rawLogOrIssueBody?: string | null;
    eventType: string;
    runId: string;
    installationId?: number;
    targetBranch: string;
    defaultBranch: string;
  }): Promise<void> {
    const { repoName, rawLogOrIssueBody, eventType, runId, installationId, targetBranch, defaultBranch } = params;

    console.log(`[SelfHealing] Starting trigger for ${repoName} (event: ${eventType}, runId: ${runId})`);

    const settings = repoSettingsRepository.findById(repoName) || {
      repositoryFullName: repoName,
      active: true,
      harnessStatus: "NONE",
      harnessSource: "NONE",
      ralphMaxRetries: 3,
    };

    if (!settings.active) {
      console.log(`[SelfHealing] Repository ${repoName} is INACTIVE. Skipping self-healing.`);
      return;
    }

    try {
      let token: string | null = null;
      if (installationId && installationId > 0) {
        token = await githubAuthService.getInstallationToken(installationId);
      }
      if (!token) {
        token = await githubAuthService.getInstallationTokenForRepo(repoName);
      }

      if (!token) {
        console.error(`[SelfHealing] Could not acquire token for repo: ${repoName}`);
        return;
      }

      // Ensure workflow file is installed on default branch
      await githubAuthService.installWorkflowIfMissing(repoName, token, defaultBranch);

      const truncator = new LogTruncator();
      const truncatedLog = truncator.truncate(rawLogOrIssueBody);

      const effectiveHarnessCmd = settings.harnessCmd || settings.inferredHarnessCmd || "";
      const globalSettings = systemSettingsRepository.getGlobalSettings();
      const effectiveAiModel = settings.customModel || globalSettings?.globalAiModel || "";
      const effectiveAiBaseUrl = settings.customBaseUrl || globalSettings?.globalAiBaseUrl || "";

      const inputs: Record<string, string> = {
        event_type: eventType,
        log_content: eventType === "production_log" ? "" : truncatedLog,
        run_id: runId || "",
        target_branch: targetBranch || defaultBranch,
        slack_webhook_url: settings.slackWebhookUrl || "",
        ai_model: effectiveAiModel,
        ai_base_url: effectiveAiBaseUrl,
        harness_cmd: effectiveHarnessCmd,
        ralph_max_retries: String(settings.ralphMaxRetries > 0 ? settings.ralphMaxRetries : 3),
        pikiland_server_url: this.getEffectiveServerUrl(),
      };

      console.log(`[SelfHealing] Dispatching 'pikiland.yml' on ref '${defaultBranch}' for target '${targetBranch}'`);
      await githubAuthService.triggerWorkflowDispatch({
        repoFullName: repoName,
        workflowId: "pikiland.yml",
        ref: defaultBranch,
        inputs,
        token,
      });
    } catch (e: any) {
      console.error(`[SelfHealing] Fatal error triggering workflow dispatch for ${repoName}:`, e.message);
    }
  }
}

export const selfHealingService = new SelfHealingService();
