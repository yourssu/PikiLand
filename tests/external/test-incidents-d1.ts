import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { sign, decode } from "hono/jwt";
import app from "../../src/index";
import {
  activateRun,
  bindRun,
  completeRun,
  createIncidentAndReserve,
} from "../../src/incidents/engineRuns";

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-11-04",
    d1Databases: { DB: "incident-local-test" },
  }),
);
const originalFetch = globalThis.fetch;
try {
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  for (const file of readdirSync("migrations")
    .filter((p) => p.endsWith(".sql"))
    .sort()) {
    const statements = readFileSync(`migrations/${file}`, "utf8")
      .split(/;(?=\s*(?:CREATE|$))/)
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }
  for (const id of [100, 200])
    await db
      .prepare(
        `INSERT INTO repositories(repo_id, installation_id, owner, name, branch, llm_base_url, llm_api_key_ciphertext, llm_model_name, slack_webhook_url_ciphertext, prod_server_url, prod_server_token_ciphertext)
    VALUES (?, 10, 'owner', 'repo', 'main', 'https://example.com', 'encrypted', 'model', 'encrypted', 'https://example.com', 'encrypted')`,
      )
      .bind(id)
      .run();
  const active = await db
    .prepare(
      "SELECT is_active, typeof(is_active) AS storage_type FROM repositories WHERE repo_id = 100",
    )
    .first();
  console.log("D1 boolean storage:", active);
  assert.equal((active as any).is_active, 1);
  const workflow = "owner/repo/.github/workflows/heal.yml@refs/heads/main";
  const input = {
    repo_id: 100,
    date: "2026-11-25T00:00:00Z",
    summary: "error",
    logs: [{ date: "2026-11-25T00:00:00Z", log: "error" }],
    workflow_ref: workflow,
  };
  const [first, second] = await Promise.all([
    createIncidentAndReserve(db, input),
    createIncidentAndReserve(db, input),
  ]);
  const ordered = [first, second].sort(
    (a, b) => a.reservation_id - b.reservation_id,
  );
  assert.notEqual(first.incident_id, second.incident_id);
  for (const entry of ordered)
    assert.equal(
      (
        (await db
          .prepare(
            "SELECT incident_id FROM incident_engine_run_incidents WHERE run_id = ?",
          )
          .bind(entry.reservation_id)
          .first()) as any
      ).incident_id,
      entry.incident_id,
    );
  const attempts = await Promise.allSettled(
    ordered.map((entry) => activateRun(db, 100, entry.reservation_id)),
  );
  assert.equal(attempts[0].status, "fulfilled");
  assert.equal(attempts[1].status, "rejected");
  await bindRun(db, 100, ordered[0].reservation_id, {
    run_id: "123",
    run_attempt: 1,
    workflow_ref: workflow,
  });
  const independent = await createIncidentAndReserve(db, {
    ...input,
    repo_id: 200,
  });
  await activateRun(db, 200, independent.reservation_id);
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
    alg: "RS256" as const,
    kid: "test",
  };
  const publicKey = {
    ...((await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey),
    alg: "RS256",
    kid: "test",
  };
  globalThis.fetch = (async (input: any, init: any) =>
    String(input) ===
    "https://token.actions.githubusercontent.com/.well-known/jwks"
      ? Response.json({ keys: [publicKey] })
      : originalFetch(input, init)) as typeof fetch;
  const env = {
    DB: db,
    OIDC_AUDIENCE: "test",
    OIDC_WORKFLOWS: JSON.stringify([workflow]),
  } as unknown as CloudflareBindings;
  const now = Math.floor(Date.now() / 1000);
  const oidc = await sign(
    {
      iss: "https://token.actions.githubusercontent.com",
      aud: "test",
      sub: "test",
      iat: now,
      exp: now + 300,
      jti: "same-jti",
      repository_id: "100",
      repository: "owner/repo",
      repository_owner: "owner",
      workflow_ref: workflow,
      ref: "refs/heads/main",
      event_name: "workflow_dispatch",
      run_id: "123",
      run_attempt: "1",
    },
    privateKey,
  );
  const issue = (credential = oidc) =>
    app.request(
      "/api/repositories/100/tokens/engine",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expires_in: 60 }),
      },
      env,
    );
  const issued = await Promise.all([issue(), issue()]);
  assert.deepEqual(issued.map((r) => r.status).sort(), [201, 401]);
  let token = ((await issued.find((r) => r.status === 201)!.json()) as any)
    .token;
  const post = () =>
    app.request(
      "/api/repositories/100/incidents",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          incident: {
            date: input.date,
            pr_generated: false,
            pr_link: null,
            summary: "updated",
            context: {
              llm: { messages: [{ role: "assistant", content: "done" }] },
              fluent_bit: input.logs,
            },
          },
        }),
      },
      env,
    );
  assert.equal((await post()).status, 201);
  const rotationJwt = await sign({ ...decode(oidc).payload, jti: "rotation-jti" }, privateKey);
  const rotation = await Promise.all([post(), issue(rotationJwt)]);
  assert.ok([201, 401].includes(rotation[0].status));
  assert.equal(rotation[1].status, 201);
  assert.equal((await post()).status, 401);
  token = (await rotation[1].json() as any).token;
  assert.equal((await post()).status, 201);
  const race = await Promise.all([
    post(),
    db
      .prepare("DELETE FROM incidents WHERE repo_id = 100 AND incident_id = ?")
      .bind(ordered[0].incident_id)
      .run(),
  ]);
  assert.ok([201, 401].includes((race[0] as Response).status));
  assert.equal((await post()).status, 401);
  await assert.rejects(() => activateRun(db, 100, ordered[1].reservation_id));
  await completeRun(db, 100, ordered[0].reservation_id);
  await activateRun(db, 100, ordered[1].reservation_id);
  assert.equal(
    await db
      .prepare("SELECT * FROM incidents WHERE incident_id = ?")
      .bind(ordered[0].incident_id)
      .first(),
    null,
  );
  assert.equal(
    (
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM repository_tokens WHERE repo_id = 100",
        )
        .first()) as any
    ).n,
    0,
  );
  assert.equal(
    (
      (await db
        .prepare("SELECT COUNT(*) AS n FROM oidc_replays")
        .first()) as any
    ).n,
    2,
  );
  await assert.rejects(() =>
    db.batch([
      db.prepare(
        "UPDATE incidents SET summary = 'rollback' WHERE repo_id = 100",
      ),
      db.prepare("UPDATE incidents SET context = '{}' WHERE repo_id = 100"),
    ]),
  );
  assert.equal(
    (
      (await db
        .prepare("SELECT summary FROM incidents WHERE repo_id = 100")
        .first()) as any
    ).summary,
    "error",
  );
  await bindRun(db, 100, ordered[1].reservation_id, { run_id: "124", run_attempt: 1, workflow_ref: workflow });
  const nextJwt = await sign({ ...decode(oidc).payload, jti: "next-jti", run_id: "124" }, privateKey);
  const nextToken = await issue(nextJwt); assert.equal(nextToken.status, 201);
  token = (await nextToken.json() as any).token;
  const completion = await Promise.all([post(), completeRun(db, 100, ordered[1].reservation_id)]);
  assert.ok([201, 401].includes((completion[0] as Response).status));
  assert.equal((await post()).status, 401);
  await db.prepare("DELETE FROM repositories WHERE repo_id = 100").run();
  assert.equal(
    (
      (await db
        .prepare("SELECT COUNT(*) AS n FROM incidents WHERE repo_id = 100")
        .first()) as any
    ).n,
    0,
  );
  console.log(
    "Local D1: FIFO concurrency, token replay rollback, POST/rotation/delete/completion races, cascades and atomic rollback passed.",
  );
} finally {
  globalThis.fetch = originalFetch;
  await mf.dispose();
}
