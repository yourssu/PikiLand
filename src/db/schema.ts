import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const repoSettingsTable = sqliteTable("repo_settings", {
  repositoryFullName: text("repository_full_name").primaryKey(),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  slackWebhookUrl: text("slack_webhook_url"),
  customModel: text("custom_model"),
  customBaseUrl: text("custom_base_url"),
  harnessCmd: text("harness_cmd"),
  inferredHarnessCmd: text("inferred_harness_cmd"),
  harnessStatus: text("harness_status").notNull().default("NONE"),
  harnessSource: text("harness_source").notNull().default("NONE"),
  ralphMaxRetries: integer("ralph_max_retries").notNull().default(3),
  logIngestActive: integer("log_ingest_active", { mode: "boolean" }).default(false),
  logReceiverToken: text("log_receiver_token"),
  ec2Ip: text("ec2_ip"),
  logPath: text("log_path"),
});

export const systemSettingsTable = sqliteTable("system_settings", {
  id: text("id").primaryKey().default("global"),
  githubAppId: text("github_app_id"),
  githubPrivateKeyContent: text("github_private_key_content"),
  githubWebhookSecret: text("github_webhook_secret"),
  githubClientId: text("github_client_id"),
  githubClientSecret: text("github_client_secret"),
  globalAiBaseUrl: text("global_ai_base_url"),
  globalAiApiKey: text("global_ai_api_key"),
  globalAiModel: text("global_ai_model"),
  pikilandServerUrl: text("pikiland_server_url"),
});

export const logFingerprintsTable = sqliteTable("log_fingerprints", {
  hash: text("hash").primaryKey(),
  repositoryFullName: text("repository_full_name").notNull(),
  normalizedSignature: text("normalized_signature").notNull(),
  rawLog: text("raw_log").notNull(),
  state: text("state").notNull().default("IN_PROGRESS"),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  prUrl: text("pr_url"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});
