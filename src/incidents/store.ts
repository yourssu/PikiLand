import { ForbiddenException } from "chanfana";
import type { IncidentDetail } from "./schema";

export type IncidentRow = {
  incident_id: number;
  repo_id: number;
  occurred_at: string;
  pr_generated: number;
  pr_link: string | null;
  summary: string;
  context: string;
  created_at: string;
};
export function detail(row: IncidentRow) {
  return {
    date: row.occurred_at,
    pr_generated: row.pr_generated === 1,
    pr_link: row.pr_link,
    summary: row.summary,
    context: JSON.parse(row.context),
  };
}
export async function getIncident(db: D1Database, repo: number, id: number) {
  const row = await db
    .prepare("SELECT * FROM incidents WHERE repo_id = ? AND incident_id = ?")
    .bind(repo, id)
    .first<IncidentRow>();
  if (!row) throw new ForbiddenException();
  return row;
}
export const engineTokenQuery = `SELECT m.incident_id FROM repository_tokens t
  JOIN incident_engine_runs r ON r.id = t.engine_run_id AND r.repo_id = t.repo_id
  JOIN incident_engine_run_incidents m ON m.run_id = r.id AND m.repo_id = r.repo_id
  WHERE t.token_hash = ? AND t.repo_id = ? AND t.purpose = 'engine'
    AND t.revoked_at IS NULL AND t.expires_at > unixepoch() AND r.state = 'active'`;
export async function replaceIncident(
  db: D1Database,
  repo: number,
  hash: string,
  incident: IncidentDetail,
) {
  return db
    .prepare(
      `UPDATE incidents SET occurred_at = ?, pr_generated = ?, pr_link = ?, summary = ?, context = ?
    WHERE repo_id = ? AND incident_id = (${engineTokenQuery}) RETURNING incident_id`,
    )
    .bind(
      new Date(incident.date).toISOString(),
      Number(incident.pr_generated),
      incident.pr_link,
      incident.summary,
      JSON.stringify(incident.context),
      repo,
      hash,
      repo,
    )
    .first<{ incident_id: number }>();
}
