import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const dbPath = process.env.DATABASE_PATH || "./data/pikiland.sqlite";

if (dbPath !== ":memory:") {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL;");

// Initialize tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS repo_settings (
    repository_full_name TEXT PRIMARY KEY,
    active INTEGER NOT NULL DEFAULT 0,
    slack_webhook_url TEXT,
    custom_model TEXT,
    custom_base_url TEXT,
    harness_cmd TEXT,
    inferred_harness_cmd TEXT,
    harness_status TEXT NOT NULL DEFAULT 'NONE',
    harness_source TEXT NOT NULL DEFAULT 'NONE',
    ralph_max_retries INTEGER NOT NULL DEFAULT 3,
    log_ingest_active INTEGER DEFAULT 0,
    log_receiver_token TEXT,
    ec2_ip TEXT,
    log_path TEXT
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    id TEXT PRIMARY KEY DEFAULT 'global',
    github_app_id TEXT,
    github_private_key_content TEXT,
    github_webhook_secret TEXT,
    github_client_id TEXT,
    github_client_secret TEXT,
    global_ai_base_url TEXT,
    global_ai_api_key TEXT,
    global_ai_model TEXT,
    pikiland_server_url TEXT
  );

  CREATE TABLE IF NOT EXISTS log_fingerprints (
    hash TEXT PRIMARY KEY,
    repository_full_name TEXT NOT NULL,
    normalized_signature TEXT NOT NULL,
    raw_log TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    pr_url TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
`);

export const db = drizzle(sqlite, { schema });
export { sqlite };
