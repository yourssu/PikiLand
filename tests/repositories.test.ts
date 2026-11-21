/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { fromHono } from "chanfana";
import { sign } from "hono/jwt";
import app from "../src/index";
import { ListRepositories } from "../src/endpoints/listRepositories";
import {
  CreateRepository,
  DeleteRepository,
  GetRepository,
  UpdateRepository,
} from "../src/endpoints/repository";

const config = {
  llm_base_url: "https://example.com/v1",
  llm_api_key: "secret-llm",
  llm_model_name: "model",
  slack_webhook_url: "https://example.com/slack-secret",
  prod_server_url: "https://example.com",
  prod_server_token: "secret-prod",
  extra: { value: 1 },
};
const originalFetch = globalThis.fetch;
let sqlite: Database;
let env: CloudflareBindings;
let cookie: string;
let role: "admin" | "maintain" | "pull";
let githubStatus: number;
let repoVisible: boolean;
let calls: string[];

beforeEach(async () => {
  sqlite = new Database(":memory:");
  for (const file of [
    "0001_create_oauth_states.sql",
    "0002_create_sessions.sql",
    "0003_create_repositories.sql",
  ]) {
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  sqlite.run(
    "INSERT INTO sessions VALUES (1, 'github-test', datetime('now', '+1 hour'))",
  );
  const db = {
    prepare(sql: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async first() {
          return sqlite.query(sql).get(...values);
        },
        async all() {
          return { results: sqlite.query(sql).all(...values) };
        },
        async run() {
          return {
            meta: { changes: sqlite.query(sql).run(...values).changes },
          };
        },
      };
    },
  };
  env = {
    DB: db,
    JWT_SECRET: "test-only-secret",
    REPOSITORY_ENCRYPTION_KEY: btoa("a".repeat(32)),
  } as unknown as CloudflareBindings;
  cookie = `__Host-token=${await sign({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 }, env.JWT_SECRET)}`;
  role = "admin";
  githubStatus = 200;
  repoVisible = true;
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (githubStatus !== 200) return new Response("", { status: githubStatus });
    if (url.includes("/user/installations?"))
      return Response.json({ installations: [{ id: 10 }] });
    if (url.includes("/user/installations/10/repositories?"))
      return Response.json({
        repositories: repoVisible
          ? [
              {
                id: 100,
                name: "repo",
                owner: { login: "owner" },
                permissions: { [role]: true },
              },
            ]
          : [],
      });
    return new Response("", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  sqlite.close();
});

function request(path = "/api/repositories", method = "GET", body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}
const create = () =>
  request("/api/repositories", "POST", {
    installation_id: 10,
    repo_id: 100,
    branch: "main",
    config,
  });

describe("Chanfana repository API", () => {
  test("create, encrypted detail, complete replacement, inactive list and delete", async () => {
    const created = await create();
    expect(created.status).toBe(201);
    expect(created.headers.get("Location")).toBe("/api/repositories/100");
    expect(await created.json()).toEqual({
      repo: {
        id: 100,
        owner: "owner",
        name: "repo",
        branch: "main",
        is_active: true,
      },
    });
    const stored = JSON.stringify(
      sqlite.query("SELECT * FROM repositories").get(),
    );
    for (const secret of [
      config.llm_api_key,
      config.slack_webhook_url,
      config.prod_server_token,
    ])
      expect(stored).not.toContain(secret);
    const detail = await request("/api/repositories/100");
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as any).config).toEqual(config);
    const replacement = { ...config, extra: null };
    const updated = await request("/api/repositories/100", "POST", {
      branch: "next",
      is_active: false,
      config: replacement,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ repo_id: 100 });
    expect(
      ((await (await request("/api/repositories/100")).json()) as any).config,
    ).toEqual(replacement);
    expect(
      ((await (await request()).json()) as any).page_stats.total_count,
    ).toBe(0);
    const all = await request(
      "/api/repositories?filter_active=false&per_page=1",
    );
    expect(all.status).toBe(200);
    expect(((await all.json()) as any).page_stats).toEqual({
      page: 1,
      per_page: 1,
      total_count: 1,
      total_pages: 1,
    });
    expect((await request("/api/repositories/100", "DELETE")).status).toBe(200);
    expect(sqlite.query("SELECT * FROM repositories").get()).toBeNull();
  });
  test("returns registered repositories only", async () => {
    expect(((await (await request()).json()) as any).repos).toEqual([]);
    await create();
    repoVisible = false;
    expect(((await (await request()).json()) as any).repos).toEqual([]);
    expect((await request("/api/repositories/100")).status).toBe(403);
  });
  test("admin and maintain can manage, read permission cannot", async () => {
    role = "maintain";
    expect((await create()).status).toBe(201);
    role = "pull";
    expect((await request("/api/repositories/100")).status).toBe(200);
    expect(
      (
        await request("/api/repositories/100", "POST", {
          branch: "main",
          is_active: true,
          config,
        })
      ).status,
    ).toBe(403);
    expect((await request("/api/repositories/100", "DELETE")).status).toBe(403);
  });
  test("rejects duplicate, inaccessible installation and missing repository", async () => {
    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(403);
    expect((await request("/api/repositories/101")).status).toBe(403);
    expect(
      (
        await request("/api/repositories", "POST", {
          installation_id: 11,
          repo_id: 101,
          branch: "main",
          config,
        })
      ).status,
    ).toBe(403);
  });
  test("Chanfana validates queries, path, required config and full replacement", async () => {
    for (const query of [
      "per_page=31",
      "per_page=0",
      "page=0",
      "page=abc",
      "filter_active=other",
    ]) {
      expect((await request(`/api/repositories?${query}`)).status).toBe(400);
    }
    expect((await request("/api/repositories/not-an-id")).status).toBe(400);
    expect(
      (
        await request("/api/repositories", "POST", {
          installation_id: 10,
          repo_id: 100,
          branch: "main",
          config: {},
        })
      ).status,
    ).toBe(400);
    expect(
      (await request("/api/repositories/100", "POST", { config })).status,
    ).toBe(400);
    expect(
      (
        await request("/api/repositories/100", "POST", {
          config,
          branch: "main",
          is_active: true,
          extra: 1,
        })
      ).status,
    ).toBe(400);
  });
  test("existing cookie and database session remain required", async () => {
    cookie = "";
    expect((await request()).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  test("expired database session and revoked GitHub credential fail", async () => {
    sqlite.run("UPDATE sessions SET expires_at = datetime('now', '-1 hour')");
    expect((await request()).status).toBe(401);
    sqlite.run("UPDATE sessions SET expires_at = datetime('now', '+1 hour')");
    githubStatus = 401;
    expect((await request()).status).toBe(401);
  });
  test("GitHub failures do not write repository records", async () => {
    githubStatus = 500;
    expect((await create()).status).toBe(500);
    expect(sqlite.query("SELECT * FROM repositories").get()).toBeNull();
  });
  test("missing encryption key fails without storing plaintext", async () => {
    delete (env as any).REPOSITORY_ENCRYPTION_KEY;
    expect((await create()).status).toBe(500);
    expect(sqlite.query("SELECT * FROM repositories").get()).toBeNull();
  });
  test("generates all five repository operations from Chanfana classes", async () => {
    const router = new Hono();
    const openapi = fromHono(router, { docs_url: null, redoc_url: null });
    openapi.registry.registerComponent("securitySchemes", "cookieAuth", {
      type: "apiKey",
      in: "cookie",
      name: "__Host-token",
    });
    openapi.get("/repositories", ListRepositories);
    openapi.post("/repositories", CreateRepository);
    openapi.get("/repositories/:repo_id", GetRepository);
    openapi.post("/repositories/:repo_id", UpdateRepository);
    openapi.delete("/repositories/:repo_id", DeleteRepository);
    const response = await router.request("/openapi.json");
    expect(response.status).toBe(200);
    const schema = (await response.json()) as any;
    expect(Object.keys(schema.paths)).toEqual([
      "/repositories",
      "/repositories/{repo_id}",
    ]);
    expect(Object.keys(schema.paths["/repositories/{repo_id}"])).toEqual([
      "get",
      "post",
      "delete",
    ]);
    const list = schema.paths["/repositories"].get;
    expect(
      list.parameters.find((p: any) => p.name === "per_page").schema.maximum,
    ).toBe(30);
    expect(
      schema.paths["/repositories"].post.responses[201].headers.Location,
    ).toBeDefined();
    expect(
      schema.paths["/repositories/{repo_id}"].post.requestBody.content[
        "application/json"
      ].schema.required,
    ).toEqual(["is_active", "branch", "config"]);
  });
});
