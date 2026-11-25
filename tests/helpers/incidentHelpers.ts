/// <reference types="bun" />
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { sign } from "hono/jwt";
import app from "../../src/index";
import {
  activateRun,
  bindRun,
  createIncidentAndReserve,
} from "../../src/incidents/engineRuns";

export const workflow = "owner/repo/.github/workflows/heal.yml@refs/heads/main";
export const logs = [
  {
    date: "2026-11-25T09:00:00+09:00",
    level: "ERROR",
    log: "example error",
    extra: { count: 1 },
  },
];
export const result = {
  incident: {
    date: "2026-11-25T01:00:00Z",
    pr_generated: true,
    pr_link: "https://example.com/pr/1",
    summary: "fixed",
    context: {
      llm: { messages: [{ role: "assistant", content: "fixed" }] },
      fluent_bit: logs,
    },
  },
};
export function sqliteD1() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync("migrations")
    .filter((p) => p.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  function prepare(sql: string) {
    let values: any[] = [];
    return {
      bind(...args: any[]) {
        values = args;
        return this;
      },
      execute() {
        const query = sqlite.query(sql);
        const rows = query.all(...values);
        return {
          success: true,
          results: rows,
          meta: {
            changes: (sqlite.query("SELECT changes() AS count").get() as any)
              .count,
          },
        };
      },
      async first() {
        return sqlite.query(sql).get(...values);
      },
      async all() {
        return this.execute();
      },
      async run() {
        return this.execute();
      },
    };
  }
  return {
    sqlite,
    db: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) {
        return sqlite.transaction(() => statements.map((s) => s.execute()))();
      },
    } as unknown as D1Database,
  };
}
export async function seed(db: D1Database, repo = 100) {
  await db
    .prepare(
      `INSERT INTO repositories(repo_id, installation_id, owner, name, branch, llm_base_url, llm_api_key_ciphertext, llm_model_name, slack_webhook_url_ciphertext, prod_server_url, prod_server_token_ciphertext)
    VALUES (?, 10, 'owner', 'repo', 'main', 'https://example.com', 'encrypted', 'model', 'encrypted', 'https://example.com', 'encrypted')`,
    )
    .bind(repo)
    .run();
}
export async function fixture() {
  const { sqlite, db } = sqliteD1();
  await seed(db);
  await db
    .prepare(
      "INSERT INTO sessions VALUES (1, 'github-test', datetime('now', '+1 hour'))",
    )
    .run();
  const env = {
    DB: db,
    JWT_SECRET: "test-only-secret",
    OIDC_AUDIENCE: "pikiland-test",
    OIDC_WORKFLOWS: JSON.stringify([workflow]),
  } as unknown as CloudflareBindings;
  const cookie = `__Host-token=${await sign({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 }, env.JWT_SECRET)}`;
  const keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const privateKey = {
    ...((await crypto.subtle.exportKey(
      "jwk",
      keys.privateKey,
    )) as JsonWebKey & { kty: string }),
    kid: "test-key",
    alg: "RS256" as const,
  };
  const publicKey = {
    ...((await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey & {
      kty: string;
    }),
    kid: "test-key",
    alg: "RS256",
  };
  let permission = "admin";
  let githubStatus = 200;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url === "https://token.actions.githubusercontent.com/.well-known/jwks")
      return Response.json({ keys: [publicKey] });
    if (githubStatus !== 200) return new Response("", { status: githubStatus });
    if (url.includes("/installations/10/repositories"))
      return Response.json({
        repositories: [100, 200].map((id) => ({
          id,
          owner: { login: "owner" },
          name: "repo",
          permissions: { [permission]: true },
        })),
      });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  function request(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    useCookie = false,
  ) {
    return app.request(
      path,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(useCookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  }
  async function oidc(overrides: Record<string, any> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return sign(
      {
        iss: "https://token.actions.githubusercontent.com",
        aud: "pikiland-test",
        sub: "repo:owner/repo:ref:refs/heads/main",
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + 300,
        repository_id: "100",
        repository: "owner/repo",
        repository_owner: "owner",
        workflow_ref: workflow,
        ref: "refs/heads/main",
        event_name: "workflow_dispatch",
        run_id: "123",
        run_attempt: "1",
        ...overrides,
      },
      privateKey,
    );
  }
  async function reservation(repo = 100, run = "123", date = logs[0].date) {
    const item = await createIncidentAndReserve(db, {
      repo_id: repo,
      date,
      summary: "error",
      logs,
      workflow_ref: workflow,
    });
    await activateRun(db, repo, item.reservation_id);
    await bindRun(db, repo, item.reservation_id, {
      run_id: run,
      run_attempt: 1,
      workflow_ref: workflow,
    });
    return item;
  }
  async function issue(token?: string, ttl = 21900) {
    return request(
      "/api/repositories/100/tokens/engine",
      "POST",
      { expires_in: ttl },
      token ?? (await oidc()),
    );
  }
  return {
    sqlite,
    db,
    env,
    request,
    oidc,
    reservation,
    issue,
    role(value: string) {
      permission = value;
    },
    githubStatus(value: number) {
      githubStatus = value;
    },
    close() {
      globalThis.fetch = oldFetch;
      sqlite.close();
    },
  };
}
