import { createHash } from "crypto";
import { sqlite } from "../db";
import { ProductionSignal } from "../domain/production-signal";
import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";
import { githubAuthService } from "./github-auth.service";
import { selfHealingService } from "./self-healing.service";

sqlite.exec(`CREATE TABLE IF NOT EXISTS production_signals (
  repo TEXT NOT NULL, signal_id TEXT NOT NULL, incident_id TEXT NOT NULL, received_at INTEGER NOT NULL,
  PRIMARY KEY(repo, signal_id));
CREATE TABLE IF NOT EXISTS production_jobs (
  incident_id TEXT PRIMARY KEY, repo TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'QUEUED',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT,
  outcome TEXT, UNIQUE(repo, incident_id));`);

export class ProductionSignalService {
  accept(repo: string, signal: ProductionSignal, now = Date.now()): string {
    const id = createHash("sha256").update(JSON.stringify([repo, signal.environment, signal.service, signal.observerId, signal.ruleId, signal.ruleVersion, signal.route])).digest("hex");
    // Transactional inbox + incident + outbox. A retry cannot increment occurrences twice.
    sqlite.transaction(() => {
      sqlite.query("DELETE FROM production_signals WHERE received_at<?").run(now-7*86400000);
      const inserted = sqlite.query("INSERT OR IGNORE INTO production_signals VALUES (?, ?, ?, ?)").run(repo, signal.signalId, id, now);
      if (!inserted.changes) return;
      const existing = sqlite.query("SELECT state FROM log_fingerprints WHERE hash=?").get(id) as {state:string} | null;
      if (existing) {
        sqlite.query("UPDATE log_fingerprints SET occurrence_count=occurrence_count+1, last_seen_at=? WHERE hash=?").run(new Date(now).toISOString(), id);
        const job=sqlite.query("SELECT incident_id FROM production_jobs WHERE incident_id=?").get(id);
        if (!signal.quality.complete || job) return; // immutable evidence once analysis is scheduled
        sqlite.query("DELETE FROM log_fingerprints WHERE hash=? AND state='NEEDS_EVIDENCE'").run(id);
      } else if ((sqlite.query("SELECT count(*) AS n FROM log_fingerprints WHERE repository_full_name=?").get(repo) as {n:number}).n >= 1000) {
        throw new Error("Incident capacity reached; review and archive existing incidents");
      }
      const time = new Date(now).toISOString();
      const bundle = JSON.stringify({ schemaVersion: 1, source: "production_log", repository: repo, incidentId: id,
        observation: signal, limitations: ["Access logs do not prove business correctness or root cause.", "No request bodies, headers, client addresses or raw URLs are collected.", "Deployment SHA is not available from default access logs."] });
      sqlite.query("INSERT INTO log_fingerprints (hash,repository_full_name,normalized_signature,raw_log,state,occurrence_count,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,1,?,?)")
        .run(id, repo, `${signal.ruleId}: ${signal.service}/${signal.route}`, bundle, signal.quality.complete ? "IN_PROGRESS" : "NEEDS_EVIDENCE", time, time);
      if (signal.quality.complete) sqlite.query("INSERT INTO production_jobs (incident_id,repo,created_at,updated_at) VALUES (?,?,?,?)").run(id, repo, now, now);
    })();
    return id;
  }

  async drain(dispatch = async (repo: string, id: string) => {
    const branch = await githubAuthService.getDefaultBranchForRepo(repo);
    await selfHealingService.runSelfHealing({repoName:repo,eventType:"production_log",runId:id,targetBranch:branch,defaultBranch:branch});
  }): Promise<void> {
    // An interrupted dispatch is ambiguous: do not blindly dispatch it again.
    sqlite.query("UPDATE production_jobs SET state='DISPATCH_UNKNOWN',error='Dispatcher interrupted; reconcile Actions before retry' WHERE state='DISPATCHING' AND updated_at<?").run(Date.now()-300000);
    const job = sqlite.query(`SELECT j.incident_id,j.repo FROM production_jobs j JOIN repo_settings r ON r.repository_full_name=j.repo
      WHERE j.state='QUEUED' AND r.active=1 AND r.log_ingest_active=1
      AND (SELECT count(*) FROM production_jobs busy WHERE busy.repo=j.repo AND busy.state IN ('DISPATCHING','DISPATCHED','DISPATCH_UNKNOWN')) < 2
      AND (SELECT count(*) FROM production_jobs recent WHERE recent.repo=j.repo AND recent.state!='QUEUED' AND recent.updated_at > strftime('%s','now')*1000-86400000) < 10
      ORDER BY j.created_at LIMIT 1`).get() as {incident_id:string;repo:string} | null;
    if (!job) return;
    const settings = repoSettingsRepository.findById(job.repo);
    if (!settings?.active || !settings.logIngestActive) return;
    const claimed = sqlite.query("UPDATE production_jobs SET state='DISPATCHING',updated_at=? WHERE incident_id=? AND state='QUEUED'").run(Date.now(),job.incident_id);
    if (!claimed.changes) return;
    try {
      await dispatch(job.repo, job.incident_id);
      sqlite.query("UPDATE production_jobs SET state='DISPATCHED',updated_at=? WHERE incident_id=? AND state='DISPATCHING'").run(Date.now(),job.incident_id);
    } catch {
      sqlite.query("UPDATE production_jobs SET state='DISPATCH_UNKNOWN',error='Dispatch failed; reconcile before retry',updated_at=? WHERE incident_id=? AND state='DISPATCHING'").run(Date.now(),job.incident_id);
    }
  }

  finish(repo: string, id: string, outcome: string): boolean {
    const result = sqlite.query("UPDATE production_jobs SET state='COMPLETED',outcome=?,updated_at=? WHERE repo=? AND incident_id=? AND state IN ('DISPATCHING','DISPATCHED','DISPATCH_UNKNOWN')").run(outcome,Date.now(),repo,id);
    if (result.changes) sqlite.query("UPDATE log_fingerprints SET state=? WHERE hash=? AND repository_full_name=? AND state='IN_PROGRESS'")
      .run(outcome === "PR_CREATED" ? "PR_CREATED" : outcome === "FAILED" ? "FAILED" : outcome === "NO_PR" ? "NO_PR" : "NEEDS_EVIDENCE",id,repo);
    return result.changes > 0;
  }
}
export const productionSignalService = new ProductionSignalService();
