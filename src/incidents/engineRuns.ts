import { ForbiddenException } from "chanfana";
import { z } from "zod";
import { incidentDetail, logBatch } from "./schema";

const initialIncident = z.object({
  repo_id: z.int().positive(),
  date: z.iso.datetime({ offset: true }),
  summary: z.string(),
  logs: logBatch,
  workflow_ref: z.string().min(1),
});

export async function createIncidentAndReserve(
  db: D1Database,
  input: z.infer<typeof initialIncident>,
) {
  const data = initialIncident.parse(input);
  const incident = incidentDetail.parse({
    date: data.date,
    summary: data.summary,
    pr_generated: false,
    pr_link: null,
    context: {
      llm: { messages: [{ role: "user", content: JSON.stringify(data.logs) }] },
      fluent_bit: data.logs,
    },
  });
  if (
    !(await db
      .prepare(
        "SELECT repo_id FROM repositories WHERE repo_id = ? AND is_active = 1",
      )
      .bind(data.repo_id)
      .first())
  )
    throw new ForbiddenException();
  // D1 batch serializes these inserts; MAX refers to the incident/run created in this transaction.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO incidents(repo_id, occurred_at, pr_generated, pr_link, summary, context)
      VALUES ((SELECT repo_id FROM repositories WHERE repo_id = ? AND is_active = 1), ?, 0, NULL, ?, ?) RETURNING incident_id`,
      )
      .bind(
        data.repo_id,
        new Date(incident.date).toISOString(),
        incident.summary,
        JSON.stringify(incident.context),
      ),
    db
      .prepare(
        "INSERT INTO incident_engine_runs(repo_id, workflow_ref) VALUES (?, ?) RETURNING id",
      )
      .bind(data.repo_id, data.workflow_ref),
    db
      .prepare(
        `INSERT INTO incident_engine_run_incidents(run_id, repo_id, incident_id)
      VALUES ((SELECT MAX(id) FROM incident_engine_runs WHERE repo_id = ?), ?, (SELECT MAX(incident_id) FROM incidents WHERE repo_id = ?))`,
      )
      .bind(data.repo_id, data.repo_id, data.repo_id),
  ]);
  return {
    incident_id: (results[0].results[0] as { incident_id: number }).incident_id,
    reservation_id: (results[1].results[0] as { id: number }).id,
  };
}

export async function activateRun(
  db: D1Database,
  repo: number,
  reservation: number,
) {
  const result = await db
    .prepare(
      `UPDATE incident_engine_runs SET state = 'active', activated_at = unixepoch()
    WHERE id = ? AND repo_id = ? AND state = 'reserved'
    AND EXISTS (SELECT 1 FROM repositories WHERE repo_id = ? AND is_active = 1)
    AND EXISTS (SELECT 1 FROM incident_engine_run_incidents WHERE run_id = ?)
    AND NOT EXISTS (SELECT 1 FROM incident_engine_runs WHERE repo_id = ? AND (state = 'active' OR (state = 'reserved' AND id < ?)))`,
    )
    .bind(reservation, repo, repo, reservation, repo, reservation)
    .run();
  if (!result.meta.changes) throw new ForbiddenException();
}

// Only a trusted dispatcher may bind an observed GitHub execution to its reservation.
export async function bindRun(
  db: D1Database,
  repo: number,
  reservation: number,
  identity: { run_id: string; run_attempt: number; workflow_ref: string },
) {
  const data = z
    .object({
      run_id: z.string().regex(/^\d+$/),
      run_attempt: z.int().min(1),
      workflow_ref: z.string().min(1),
    })
    .parse(identity);
  const result = await db
    .prepare(
      `UPDATE incident_engine_runs SET github_run_id = ?, run_attempt = ?
    WHERE id = ? AND repo_id = ? AND state = 'active' AND workflow_ref = ? AND github_run_id IS NULL
    AND EXISTS (SELECT 1 FROM incident_engine_run_incidents WHERE run_id = ?)`,
    )
    .bind(
      data.run_id,
      data.run_attempt,
      reservation,
      repo,
      data.workflow_ref,
      reservation,
    )
    .run();
  if (!result.meta.changes) throw new ForbiddenException();
}

// Call after trusted confirmation that the external job has finished, even if its incident was deleted.
export async function completeRun(
  db: D1Database,
  repo: number,
  reservation: number,
) {
  await db.batch([
    db
      .prepare(
        "UPDATE repository_tokens SET revoked_at = unixepoch() WHERE repo_id = ? AND engine_run_id = ? AND revoked_at IS NULL",
      )
      .bind(repo, reservation),
    db
      .prepare(
        "UPDATE incident_engine_runs SET state = 'completed', finished_at = unixepoch() WHERE repo_id = ? AND id = ? AND state = 'active'",
      )
      .bind(repo, reservation),
  ]);
}
