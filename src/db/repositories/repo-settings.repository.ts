import { eq } from "drizzle-orm";
import { db } from "../index";
import { repoSettingsTable } from "../schema";
import { RepoSettings, HarnessStatus, HarnessSource } from "../../domain/models";

export class RepoSettingsRepository {
  public findById(fullName: string): RepoSettings | null {
    const rows = db.select().from(repoSettingsTable).where(eq(repoSettingsTable.repositoryFullName, fullName)).all();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      repositoryFullName: r.repositoryFullName,
      active: Boolean(r.active),
      slackWebhookUrl: r.slackWebhookUrl,
      customModel: r.customModel,
      customBaseUrl: r.customBaseUrl,
      harnessCmd: r.harnessCmd,
      inferredHarnessCmd: r.inferredHarnessCmd,
      harnessStatus: r.harnessStatus as HarnessStatus,
      harnessSource: r.harnessSource as HarnessSource,
      ralphMaxRetries: r.ralphMaxRetries,
      logIngestActive: Boolean(r.logIngestActive),
      logReceiverToken: r.logReceiverToken,
      ec2Ip: r.ec2Ip,
      logPath: r.logPath,
    };
  }

  public findAll(): RepoSettings[] {
    const rows = db.select().from(repoSettingsTable).all();
    return rows.map((r) => ({
      repositoryFullName: r.repositoryFullName,
      active: Boolean(r.active),
      slackWebhookUrl: r.slackWebhookUrl,
      customModel: r.customModel,
      customBaseUrl: r.customBaseUrl,
      harnessCmd: r.harnessCmd,
      inferredHarnessCmd: r.inferredHarnessCmd,
      harnessStatus: r.harnessStatus as HarnessStatus,
      harnessSource: r.harnessSource as HarnessSource,
      ralphMaxRetries: r.ralphMaxRetries,
      logIngestActive: Boolean(r.logIngestActive),
      logReceiverToken: r.logReceiverToken,
      ec2Ip: r.ec2Ip,
      logPath: r.logPath,
    }));
  }

  public save(settings: RepoSettings): void {
    const existing = this.findById(settings.repositoryFullName);
    if (existing) {
      db.update(repoSettingsTable)
        .set({
          active: settings.active,
          slackWebhookUrl: settings.slackWebhookUrl,
          customModel: settings.customModel,
          customBaseUrl: settings.customBaseUrl,
          harnessCmd: settings.harnessCmd,
          inferredHarnessCmd: settings.inferredHarnessCmd,
          harnessStatus: settings.harnessStatus,
          harnessSource: settings.harnessSource,
          ralphMaxRetries: settings.ralphMaxRetries,
          logIngestActive: settings.logIngestActive,
          logReceiverToken: settings.logReceiverToken,
          ec2Ip: settings.ec2Ip,
          logPath: settings.logPath,
        })
        .where(eq(repoSettingsTable.repositoryFullName, settings.repositoryFullName))
        .run();
    } else {
      db.insert(repoSettingsTable)
        .values({
          repositoryFullName: settings.repositoryFullName,
          active: settings.active,
          slackWebhookUrl: settings.slackWebhookUrl,
          customModel: settings.customModel,
          customBaseUrl: settings.customBaseUrl,
          harnessCmd: settings.harnessCmd,
          inferredHarnessCmd: settings.inferredHarnessCmd,
          harnessStatus: settings.harnessStatus || "NONE",
          harnessSource: settings.harnessSource || "NONE",
          ralphMaxRetries: settings.ralphMaxRetries || 3,
          logIngestActive: settings.logIngestActive || false,
          logReceiverToken: settings.logReceiverToken,
          ec2Ip: settings.ec2Ip,
          logPath: settings.logPath,
        })
        .run();
    }
  }

  public updateLogIngestConfig(
    repositoryFullName: string,
    config: { logIngestActive: boolean; logReceiverToken: string; ec2Ip: string; logPath: string }
  ): void {
    const existing = this.findById(repositoryFullName);
    if (existing) {
      existing.logIngestActive = config.logIngestActive;
      existing.logReceiverToken = config.logReceiverToken;
      existing.ec2Ip = config.ec2Ip;
      existing.logPath = config.logPath;
      this.save(existing);
    } else {
      this.save({
        repositoryFullName,
        active: true,
        harnessStatus: "NONE",
        harnessSource: "NONE",
        ralphMaxRetries: 3,
        ...config,
      });
    }
  }
}

export const repoSettingsRepository = new RepoSettingsRepository();
