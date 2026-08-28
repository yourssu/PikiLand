import { eq } from "drizzle-orm";
import { db } from "../index";
import { systemSettingsTable } from "../schema";
import { SystemSettings } from "../../domain/models";

export class SystemSettingsRepository {
  public getGlobalSettings(): SystemSettings | null {
    const rows = db.select().from(systemSettingsTable).where(eq(systemSettingsTable.id, "global")).all();
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      githubAppId: r.githubAppId,
      githubPrivateKeyContent: r.githubPrivateKeyContent,
      githubWebhookSecret: r.githubWebhookSecret,
      githubClientId: r.githubClientId,
      githubClientSecret: r.githubClientSecret,
      globalAiBaseUrl: r.globalAiBaseUrl,
      globalAiApiKey: r.globalAiApiKey,
      globalAiModel: r.globalAiModel,
      pikilandServerUrl: r.pikilandServerUrl,
    };
  }

  public saveGlobalSettings(settings: SystemSettings): void {
    const existing = this.getGlobalSettings();
    if (existing) {
      db.update(systemSettingsTable)
        .set({
          githubAppId: settings.githubAppId,
          githubPrivateKeyContent: settings.githubPrivateKeyContent,
          githubWebhookSecret: settings.githubWebhookSecret,
          githubClientId: settings.githubClientId,
          githubClientSecret: settings.githubClientSecret,
          globalAiBaseUrl: settings.globalAiBaseUrl,
          globalAiApiKey: settings.globalAiApiKey,
          globalAiModel: settings.globalAiModel,
          pikilandServerUrl: settings.pikilandServerUrl,
        })
        .where(eq(systemSettingsTable.id, "global"))
        .run();
    } else {
      db.insert(systemSettingsTable)
        .values({
          id: "global",
          githubAppId: settings.githubAppId,
          githubPrivateKeyContent: settings.githubPrivateKeyContent,
          githubWebhookSecret: settings.githubWebhookSecret,
          githubClientId: settings.githubClientId,
          githubClientSecret: settings.githubClientSecret,
          globalAiBaseUrl: settings.globalAiBaseUrl,
          globalAiApiKey: settings.globalAiApiKey,
          globalAiModel: settings.globalAiModel,
          pikilandServerUrl: settings.pikilandServerUrl,
        })
        .run();
    }
  }
}

export const systemSettingsRepository = new SystemSettingsRepository();
