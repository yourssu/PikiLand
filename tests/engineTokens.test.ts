/// <reference types="bun" />
import { beforeEach, afterEach, expect, test } from "bun:test";
import { fixture, result, seed } from "./helpers/incidentHelpers";
import { completeRun } from "../src/incidents/engineRuns";
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
afterEach(() => f.close());

test("OIDC requires trusted active binding and verifies claims", async () => {
  expect((await f.issue()).status).toBe(403);
  await f.reservation();
  for (const claims of [
    { iss: "https://evil.example" },
    { aud: "other" },
    { exp: 1 },
    { iat: Math.floor(Date.now() / 1000) + 60 },
    { jti: "" },
    { sub: "" },
  ])
    expect((await f.issue(await f.oidc(claims))).status).toBe(401);
  for (const claims of [
    { repository_id: "200" },
    { repository: "owner/other" },
    { repository_owner: "other" },
    { workflow_ref: "owner/repo/.github/workflows/other.yml@refs/heads/main" },
    { ref: "refs/heads/other" },
    { event_name: "pull_request" },
    { run_id: "999" },
    { run_attempt: "2" },
  ])
    expect((await f.issue(await f.oidc(claims))).status).toBe(403);
  const signed = await f.oidc();
  expect(
    (await f.issue(`${signed.slice(0, -20)}${"a".repeat(20)}`)).status,
  ).toBe(401);
  expect(
    (
      await f.request(
        "/api/repositories/100/tokens/engine",
        "POST",
        { expires_in: 60 },
        undefined,
        true,
      )
    ).status,
  ).toBe(401);
});

test("token lifetime bounds, hashing, replay rollback and same-run rotation", async () => {
  await f.reservation();
  for (const ttl of [0, 21901, 1.5])
    expect((await f.issue(undefined, ttl)).status).toBe(400);
  const jwt = await f.oidc();
  const issued = await f.issue(jwt, 21900);
  expect(issued.status).toBe(201);
  expect(issued.headers.get("Cache-Control")).toBe("no-store");
  const body = (await issued.json()) as any;
  expect(body.expires_in).toBe(21900);
  const stored = (await f.db
    .prepare("SELECT * FROM repository_tokens")
    .first()) as any;
  expect(stored.token_hash).not.toBe(body.token);
  expect(stored.token_hash).toHaveLength(64);
  expect(stored.expires_at - stored.created_at).toBe(21900);
  expect((await f.issue(jwt)).status).toBe(401);
  expect(
    (
      await f.request(
        "/api/repositories/100/incidents",
        "POST",
        result,
        body.token,
      )
    ).status,
  ).toBe(201);
  const second = await f.issue(undefined, 1);
  expect(second.status).toBe(201);
  expect(
    (
      await f.request(
        "/api/repositories/100/incidents",
        "POST",
        result,
        body.token,
      )
    ).status,
  ).toBe(401);
  const newToken = ((await second.json()) as any).token;
  await f.db
    .prepare(
      "UPDATE repository_tokens SET created_at = unixepoch()-10, expires_at = unixepoch()-1 WHERE revoked_at IS NULL",
    )
    .run();
  expect(
    (
      await f.request(
        "/api/repositories/100/incidents",
        "POST",
        result,
        newToken,
      )
    ).status,
  ).toBe(401);
});

test("tokens are repo-bound, completion revokes, replay survives repository deletion", async () => {
  const run = await f.reservation();
  await seed(f.db, 200);
  const jwt = await f.oidc();
  const token = ((await (await f.issue(jwt)).json()) as any).token;
  expect(
    (await f.request("/api/repositories/200/incidents", "POST", result, token))
      .status,
  ).toBe(403);
  await completeRun(f.db, 100, run.reservation_id);
  expect(
    (await f.request("/api/repositories/100/incidents", "POST", result, token))
      .status,
  ).toBe(401);
  await f.db.prepare("DELETE FROM repositories WHERE repo_id = 100").run();
  expect(
    (
      (await f.db
        .prepare("SELECT COUNT(*) AS count FROM incidents")
        .first()) as any
    ).count,
  ).toBe(0);
  expect(
    (
      (await f.db
        .prepare("SELECT COUNT(*) AS count FROM repository_tokens")
        .first()) as any
    ).count,
  ).toBe(0);
  expect(
    (
      (await f.db
        .prepare("SELECT COUNT(*) AS count FROM oidc_replays")
        .first()) as any
    ).count,
  ).toBe(1);
});
