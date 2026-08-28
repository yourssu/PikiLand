import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";
import { systemSettingsRepository } from "../db/repositories/system-settings.repository";
import { harnessInferenceService } from "./harness-inference.service";
import { githubAuthService } from "./github-auth.service";
import { RepoSettingsDto, SystemSettingsDto, RepoSettings, SystemSettings } from "../domain/models";

export class DashboardService {
  public getSystemSettings(): SystemSettingsDto {
    const s = systemSettingsRepository.getGlobalSettings() || {
      id: "global",
      githubAppId: "",
      githubPrivateKeyContent: "",
      githubWebhookSecret: "",
      githubClientId: "",
      githubClientSecret: "",
      globalAiBaseUrl: "",
      globalAiApiKey: "",
      globalAiModel: "",
      pikilandServerUrl: "",
    };

    return {
      githubAppId: s.githubAppId || "",
      githubPrivateKeyContent: s.githubPrivateKeyContent || "",
      githubWebhookSecret: s.githubWebhookSecret || "",
      githubClientId: s.githubClientId || "",
      githubClientSecret: s.githubClientSecret || "",
      globalAiBaseUrl: s.globalAiBaseUrl || "",
      globalAiApiKey: s.globalAiApiKey || "",
      globalAiModel: s.globalAiModel || "",
      pikilandServerUrl: s.pikilandServerUrl || "",
    };
  }

  public updateSystemSettings(dto: SystemSettingsDto): void {
    const s: SystemSettings = {
      id: "global",
      githubAppId: dto.githubAppId,
      githubPrivateKeyContent: dto.githubPrivateKeyContent,
      githubWebhookSecret: dto.githubWebhookSecret,
      githubClientId: dto.githubClientId,
      githubClientSecret: dto.githubClientSecret,
      globalAiBaseUrl: dto.globalAiBaseUrl,
      globalAiApiKey: dto.globalAiApiKey,
      globalAiModel: dto.globalAiModel,
      pikilandServerUrl: dto.pikilandServerUrl,
    };
    systemSettingsRepository.saveGlobalSettings(s);
  }

  public async getUserRepositories(userAccessToken?: string | null): Promise<RepoSettingsDto[]> {
    const repos: RepoSettingsDto[] = [];
    try {
      const installedRepos = userAccessToken
        ? await githubAuthService.getUserInstalledRepositories(userAccessToken)
        : [];

      for (const fullName of installedRepos) {
        const settings = repoSettingsRepository.findById(fullName);
        if (settings) {
          repos.push({
            fullName: settings.repositoryFullName,
            active: settings.active,
            slackWebhookUrl: settings.slackWebhookUrl || "",
            customModel: settings.customModel || "",
            customBaseUrl: settings.customBaseUrl || "",
            harnessCmd: settings.harnessCmd || "",
            inferredHarnessCmd: settings.inferredHarnessCmd || "",
            harnessStatus: settings.harnessStatus,
            harnessSource: settings.harnessSource,
            ralphMaxRetries: settings.ralphMaxRetries,
            hasAppInstalled: true,
            logIngestActive: Boolean(settings.logIngestActive),
            ec2Ip: settings.ec2Ip || null,
            logPath: settings.logPath || null,
          });
        } else {
          repos.push({
            fullName,
            active: false,
            slackWebhookUrl: "",
            customModel: "",
            customBaseUrl: "",
            harnessCmd: "",
            inferredHarnessCmd: "",
            harnessStatus: "NONE",
            harnessSource: "NONE",
            ralphMaxRetries: 3,
            hasAppInstalled: true,
            logIngestActive: false,
            ec2Ip: null,
            logPath: null,
          });
        }
      }
    } catch (e: any) {
      console.error("[DashboardService] Failed to fetch user repos:", e.message);
    }
    return repos;
  }

  public async updateRepoSettings(dto: RepoSettingsDto, accessToken?: string | null): Promise<RepoSettingsDto> {
    const existing = repoSettingsRepository.findById(dto.fullName);
    let settings: RepoSettings;
    const parsedRetries = parseInt(String(dto.ralphMaxRetries), 10);
    const safeRetries = !isNaN(parsedRetries) && parsedRetries > 0 ? parsedRetries : 3;

    if (existing) {
      existing.active = Boolean(dto.active);
      existing.slackWebhookUrl = dto.slackWebhookUrl;
      existing.customModel = dto.customModel;
      existing.customBaseUrl = dto.customBaseUrl;
      if (dto.harnessCmd && dto.harnessCmd.trim().length > 0) {
        existing.harnessCmd = dto.harnessCmd;
        existing.harnessStatus = "ACTIVE";
        existing.harnessSource = "USER_PROVIDED";
        existing.inferredHarnessCmd = null;
      }
      existing.ralphMaxRetries = safeRetries;
      settings = existing;
    } else {
      const hasHarness = Boolean(dto.harnessCmd && dto.harnessCmd.trim().length > 0);
      settings = {
        repositoryFullName: dto.fullName,
        active: Boolean(dto.active),
        slackWebhookUrl: dto.slackWebhookUrl,
        customModel: dto.customModel,
        customBaseUrl: dto.customBaseUrl,
        harnessCmd: dto.harnessCmd,
        inferredHarnessCmd: dto.inferredHarnessCmd,
        harnessStatus: hasHarness ? "ACTIVE" : "NONE",
        harnessSource: hasHarness ? "USER_PROVIDED" : "NONE",
        ralphMaxRetries: safeRetries,
      };
    }

    repoSettingsRepository.save(settings);

    // Auto-infer test command if active and no harnessCmd configured yet
    if (settings.active && (!settings.harnessCmd || settings.harnessCmd.trim().length === 0)) {
      return this.reInferHarness(settings.repositoryFullName, accessToken);
    }

    const hasAppInstalled = await githubAuthService.isAppInstalledForRepo(dto.fullName);

    return {
      fullName: settings.repositoryFullName,
      active: settings.active,
      slackWebhookUrl: settings.slackWebhookUrl || "",
      customModel: settings.customModel || "",
      customBaseUrl: settings.customBaseUrl || "",
      harnessCmd: settings.harnessCmd || "",
      inferredHarnessCmd: settings.inferredHarnessCmd || "",
      harnessStatus: settings.harnessStatus,
      harnessSource: settings.harnessSource,
      ralphMaxRetries: settings.ralphMaxRetries,
      hasAppInstalled,
      logIngestActive: Boolean(settings.logIngestActive),
      ec2Ip: settings.ec2Ip || null,
      logPath: settings.logPath || null,
    };
  }

  public async approveInferredHarness(fullName: string): Promise<RepoSettingsDto> {
    const settings = repoSettingsRepository.findById(fullName);
    if (!settings) {
      throw new Error(`Repository settings not found for: ${fullName}`);
    }

    if (settings.inferredHarnessCmd && settings.inferredHarnessCmd.trim().length > 0) {
      settings.harnessCmd = settings.inferredHarnessCmd;
      settings.harnessStatus = "ACTIVE";
      settings.inferredHarnessCmd = null;
      repoSettingsRepository.save(settings);
    }

    const hasAppInstalled = await githubAuthService.isAppInstalledForRepo(fullName);

    return {
      fullName: settings.repositoryFullName,
      active: settings.active,
      slackWebhookUrl: settings.slackWebhookUrl || "",
      customModel: settings.customModel || "",
      customBaseUrl: settings.customBaseUrl || "",
      harnessCmd: settings.harnessCmd || "",
      inferredHarnessCmd: settings.inferredHarnessCmd || "",
      harnessStatus: settings.harnessStatus,
      harnessSource: settings.harnessSource,
      ralphMaxRetries: settings.ralphMaxRetries,
      hasAppInstalled,
      logIngestActive: Boolean(settings.logIngestActive),
      ec2Ip: settings.ec2Ip || null,
      logPath: settings.logPath || null,
    };
  }

  public async reInferHarness(fullName: string, accessToken?: string | null): Promise<RepoSettingsDto> {
    const filenames = await githubAuthService.fetchRepoFilenames(fullName, accessToken);
    const inferredCmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);

    const settings = repoSettingsRepository.findById(fullName) || {
      repositoryFullName: fullName,
      active: false,
      harnessStatus: "NONE",
      harnessSource: "NONE",
      ralphMaxRetries: 3,
    };

    let inferenceMsg: string | null = null;
    if (inferredCmd && inferredCmd.trim().length > 0) {
      settings.inferredHarnessCmd = inferredCmd;
      settings.harnessSource = "AUTO_INFERRED";
      settings.harnessStatus = "PENDING_CONFIRMATION";
    } else {
      settings.inferredHarnessCmd = null;
      settings.harnessSource = "NONE";
      settings.harnessStatus = "FAILED";
      inferenceMsg = "⚠️ Could not infer test command from static repository files.";
    }

    repoSettingsRepository.save(settings);
    const hasAppInstalled = await githubAuthService.isAppInstalledForRepo(fullName);

    return {
      fullName: settings.repositoryFullName,
      active: settings.active,
      slackWebhookUrl: settings.slackWebhookUrl || "",
      customModel: settings.customModel || "",
      customBaseUrl: settings.customBaseUrl || "",
      harnessCmd: settings.harnessCmd || "",
      inferredHarnessCmd: settings.inferredHarnessCmd || "",
      harnessStatus: settings.harnessStatus,
      harnessSource: settings.harnessSource,
      ralphMaxRetries: settings.ralphMaxRetries,
      hasAppInstalled,
      inferenceMessage: inferenceMsg,
      logIngestActive: Boolean(settings.logIngestActive),
      ec2Ip: settings.ec2Ip || null,
      logPath: settings.logPath || null,
    };
  }
}

export const dashboardService = new DashboardService();
