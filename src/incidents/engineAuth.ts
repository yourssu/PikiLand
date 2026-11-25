import { verifyWithJwks } from "hono/jwt";
import { HTTPException } from "hono/http-exception";
import { InternalServerErrorException } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { engineTokenQuery } from "./store";

export type EngineBindings = {
  OIDC_AUDIENCE?: string;
  OIDC_WORKFLOWS?: string;
};
export function deny(status: 401 | 403, runner = false): never {
  const title = status === 401 ? "Unauthorized" : "Forbidden";
  throw new HTTPException(status, {
    res: new Response(
      JSON.stringify({
        type: "about:blank",
        title,
        status,
        detail:
          status === 401
            ? "유효한 Bearer 인증이 필요합니다."
            : "요청한 리소스 또는 실행에 대한 권한이 없습니다.",
      }),
      {
        status,
        headers: {
          "Content-Type": "application/problem+json",
          ...(status === 401
            ? {
                "WWW-Authenticate": `Bearer realm="${runner ? "pikiland-runner" : "pikiland"}"`,
              }
            : {}),
        },
      },
    ),
  });
}
export function bearer(c: AppContext, runner = false) {
  const match = /^Bearer ([^\s]+)$/i.exec(c.req.header("Authorization") ?? "");
  if (!match) deny(401, runner);
  return match[1];
}
export async function tokenHash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export async function authenticateEngine(c: AppContext, repo: number) {
  const hash = await tokenHash(bearer(c));
  const token = await c.env.DB.prepare(
    `SELECT repo_id FROM repository_tokens WHERE token_hash = ? AND purpose = 'engine' AND revoked_at IS NULL AND expires_at > unixepoch()`,
  )
    .bind(hash)
    .first<{ repo_id: number }>();
  if (!token) deny(401);
  if (token.repo_id !== repo) deny(403);
  if (!(await c.env.DB.prepare(engineTokenQuery).bind(hash, repo).first()))
    deny(401);
  return hash;
}

const claims = z.object({
  sub: z.string().min(1),
  jti: z.string().min(1),
  exp: z.int(),
  iat: z.int(),
  nbf: z.int().optional(),
  repository_id: z.string().regex(/^\d+$/),
  repository: z.string(),
  repository_owner: z.string(),
  workflow_ref: z.string().min(1),
  ref: z.string().min(1),
  event_name: z.string(),
  run_id: z.string().regex(/^\d+$/),
  run_attempt: z.string().regex(/^[1-9]\d*$/),
});
export async function authenticateOidc(c: AppContext, repo: number) {
  const token = bearer(c, true);
  const settings = c.env as CloudflareBindings & EngineBindings;
  let workflows: string[];
  try {
    if (!settings.OIDC_AUDIENCE?.trim()) throw new Error();
    workflows = z
      .array(z.string().min(1))
      .min(1)
      .parse(JSON.parse(settings.OIDC_WORKFLOWS ?? ""));
  } catch {
    throw new InternalServerErrorException();
  }
  let identity: z.infer<typeof claims>;
  try {
    const payload = await verifyWithJwks(token, {
      jwks_uri: "https://token.actions.githubusercontent.com/.well-known/jwks",
      allowedAlgorithms: ["RS256"],
      verification: {
        iss: "https://token.actions.githubusercontent.com",
        aud: settings.OIDC_AUDIENCE,
      },
    });
    identity = claims.parse(payload);
    if (
      identity.exp <= identity.iat ||
      !Number.isSafeInteger(Number(identity.run_attempt))
    )
      deny(401, true);
  } catch {
    deny(401, true);
  }
  const repository = await c.env.DB.prepare(
    "SELECT owner, name FROM repositories WHERE repo_id = ? AND is_active = 1",
  )
    .bind(repo)
    .first<{ owner: string; name: string }>();
  if (
    !repository ||
    identity.repository_id !== String(repo) ||
    identity.repository !== `${repository.owner}/${repository.name}` ||
    identity.repository_owner !== repository.owner ||
    !workflows.includes(identity.workflow_ref) ||
    !identity.workflow_ref.startsWith(
      `${identity.repository}/.github/workflows/`,
    ) ||
    !identity.workflow_ref.endsWith(`@${identity.ref}`) ||
    identity.event_name !== "workflow_dispatch"
  )
    deny(403, true);
  const run = await c.env.DB.prepare(
    `SELECT r.id FROM incident_engine_runs r JOIN incident_engine_run_incidents m ON m.run_id = r.id AND m.repo_id = r.repo_id
    WHERE r.repo_id = ? AND r.state = 'active' AND r.github_run_id = ? AND r.run_attempt = ? AND r.workflow_ref = ?`,
  )
    .bind(
      repo,
      identity.run_id,
      Number(identity.run_attempt),
      identity.workflow_ref,
    )
    .first<{ id: number }>();
  if (!run) deny(403, true);
  return { ...identity, reservation_id: run.id };
}

export async function issueEngineToken(
  c: AppContext,
  repo: number,
  ttl: number,
  identity: Awaited<ReturnType<typeof authenticateOidc>>,
) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  const hash = await tokenHash(token);
  const now = Math.floor(Date.now() / 1000);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO oidc_replays(jti, expires_at) VALUES (?, ?)",
      ).bind(identity.jti, identity.exp),
      c.env.DB.prepare(
        "UPDATE repository_tokens SET revoked_at = unixepoch() WHERE repo_id = ? AND purpose = 'engine' AND revoked_at IS NULL",
      ).bind(repo),
      c.env.DB.prepare(
        `INSERT INTO repository_tokens(token_hash, repo_id, purpose, created_at, expires_at, oidc_jti, run_id, run_attempt, workflow_ref, engine_run_id)
        VALUES (?, ?, 'engine', ?, ?, ?, ?, ?, ?, (
          SELECT r.id FROM incident_engine_runs r JOIN repositories p ON p.repo_id = r.repo_id
          JOIN incident_engine_run_incidents m ON m.run_id = r.id AND m.repo_id = r.repo_id
          WHERE r.id = ? AND r.repo_id = ? AND r.state = 'active' AND p.is_active = 1
            AND r.github_run_id = ? AND r.run_attempt = ? AND r.workflow_ref = ? AND ? > unixepoch()
        ))`,
      ).bind(
        hash,
        repo,
        now,
        now + ttl,
        identity.jti,
        identity.run_id,
        Number(identity.run_attempt),
        identity.workflow_ref,
        identity.reservation_id,
        repo,
        identity.run_id,
        Number(identity.run_attempt),
        identity.workflow_ref,
        identity.exp,
      ),
    ]);
  } catch (error) {
    if (
      await c.env.DB.prepare("SELECT jti FROM oidc_replays WHERE jti = ?")
        .bind(identity.jti)
        .first()
    )
      deny(401, true);
    if (/constraint/i.test(String(error))) deny(403, true);
    throw new InternalServerErrorException();
  }
  return {
    repo_id: repo,
    token,
    token_type: "bearer" as const,
    purpose: "engine" as const,
    expires_in: ttl,
    issued_at: new Date(now * 1000).toISOString(),
    expires_at: new Date((now + ttl) * 1000).toISOString(),
  };
}
