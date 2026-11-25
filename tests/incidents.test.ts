/// <reference types="bun" />
import { afterEach, beforeEach, expect, test } from "bun:test";
import { fixture, logs, result, seed, workflow } from "./helpers/incidentHelpers";
import {
  activateRun,
  completeRun,
  createIncidentAndReserve,
} from "../src/incidents/engineRuns";
import { envelope } from "../src/incidents/schema";
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
afterEach(() => f.close());

test("internal creation, latest-first pagination, complete context and repository isolation", async () => {
  const first = await createIncidentAndReserve(f.db, {
    repo_id: 100,
    date: logs[0].date,
    summary: "one",
    logs,
    workflow_ref: workflow,
  });
  const second = await createIncidentAndReserve(f.db, {
    repo_id: 100,
    date: "2026-11-25T00:00:00Z",
    summary: "two",
    logs,
    workflow_ref: workflow,
  });
  await seed(f.db, 200);
  const response = await f.request(
    "/api/repositories/100/incidents?per_page=1",
    "GET",
    undefined,
    undefined,
    true,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.incidents[0].id).toBe(second.incident_id);
  expect(body.incidents[0].context).toBeUndefined();
  expect(body.page_stats).toEqual({
    page: 1,
    per_page: 1,
    total_count: 2,
    total_pages: 2,
  });
  const detail = (await (
    await f.request(
      `/api/repositories/100/incidents/${first.incident_id}`,
      "GET",
      undefined,
      undefined,
      true,
    )
  ).json()) as any;
  expect(detail.incident.date).toBe("2026-11-25T00:00:00.000Z");
  expect(detail.incident.context.fluent_bit).toEqual(logs);
  expect(detail.incident.context.llm.messages[0]).toEqual({
    role: "user",
    content: JSON.stringify(logs),
  });
  expect(
    (
      await f.request(
        `/api/repositories/200/incidents/${first.incident_id}`,
        "GET",
        undefined,
        undefined,
        true,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      (await (
        await f.request(
          "/api/repositories/200/incidents",
          "GET",
          undefined,
          undefined,
          true,
        )
      ).json()) as any
    ).page_stats.total_count,
  ).toBe(0);
  for (const query of ["page=0", "per_page=31", "page=bad"])
    expect(
      (
        await f.request(
          `/api/repositories/100/incidents?${query}`,
          "GET",
          undefined,
          undefined,
          true,
        )
      ).status,
    ).toBe(400);
});

test("user permissions and inactive reads/deletes; reserved deletion cancels queue", async () => {
  const item = await createIncidentAndReserve(f.db, {
    repo_id: 100,
    date: logs[0].date,
    summary: "error",
    logs,
    workflow_ref: workflow,
  });
  const path = `/api/repositories/100/incidents/${item.incident_id}`;
  expect((await f.request(path)).status).toBe(401);
  f.role("push");
  expect(
    (await f.request(path, "DELETE", undefined, undefined, true)).status,
  ).toBe(403);
  f.role("pull");
  expect(
    (await f.request(path, "GET", undefined, undefined, true)).status,
  ).toBe(200);
  await f.db.prepare("UPDATE repositories SET is_active = 0").run();
  f.role("maintain");
  expect(
    (await f.request(path, "GET", undefined, undefined, true)).status,
  ).toBe(200);
  const deleted = await f.request(path, "DELETE", undefined, undefined, true);
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({ incident_id: item.incident_id });
  expect(
    (
      (await f.db
        .prepare("SELECT state FROM incident_engine_runs")
        .first()) as any
    ).state,
  ).toBe("cancelled");
  expect(
    (await f.request(path, "DELETE", undefined, undefined, true)).status,
  ).toBe(403);
});

test("engine overwrites only its incident, empty 201 Location, no new run or trigger", async () => {
  const item = await f.reservation();
  const token = ((await (await f.issue()).json()) as any).token;
  const before = await f.db.prepare("SELECT created_at FROM incidents").first();
  const response = await f.request(
    "/api/repositories/100/incidents",
    "POST",
    { ...result, incident_id: 999, incident: { ...result.incident, id: 999 } },
    token,
  );
  expect(response.status).toBe(201);
  expect(await response.text()).toBe("");
  expect(response.headers.get("Location")).toBe(
    `/api/repositories/100/incidents/${item.incident_id}`,
  );
  const row = (await f.db.prepare("SELECT * FROM incidents").first()) as any;
  expect(row.incident_id).toBe(item.incident_id);
  expect(row.created_at).toBe((before as any).created_at);
  expect(row.summary).toBe("fixed");
  expect(JSON.parse(row.context)).toEqual(result.incident.context);
  expect(
    (
      (await f.db
        .prepare("SELECT COUNT(*) AS count FROM incident_engine_runs")
        .first()) as any
    ).count,
  ).toBe(1);
  expect(
    (
      await f.request(
        "/api/repositories/100/incidents",
        "POST",
        result,
        undefined,
        true,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await f.request(
        "/api/repositories/100/incidents",
        "POST",
        result,
        await f.oidc(),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await f.request(
        "/api/repositories/100/incidents",
        "GET",
        undefined,
        token,
      )
    ).status,
  ).toBe(401);
  await f.db.prepare("UPDATE repositories SET is_active = 0").run();
  expect(
    (await f.request("/api/repositories/100/incidents", "POST", result, token))
      .status,
  ).toBe(201);
  expect((await f.issue()).status).toBe(403);
});

test("FIFO active slot survives incident deletion and expires only through trusted completion", async () => {
  const active = await f.reservation();
  const token = ((await (await f.issue()).json()) as any).token;
  const next = await createIncidentAndReserve(f.db, {
    repo_id: 100,
    date: logs[0].date,
    summary: "next",
    logs,
    workflow_ref: workflow,
  });
  await expect(activateRun(f.db, 100, next.reservation_id)).rejects.toThrow();
  await f.request(
    `/api/repositories/100/incidents/${active.incident_id}`,
    "DELETE",
    undefined,
    undefined,
    true,
  );
  expect(
    (await f.request("/api/repositories/100/incidents", "POST", result, token))
      .status,
  ).toBe(401);
  await expect(activateRun(f.db, 100, next.reservation_id)).rejects.toThrow();
  await completeRun(f.db, 100, active.reservation_id);
  await activateRun(f.db, 100, next.reservation_id);
  expect(
    (
      (await f.db
        .prepare("SELECT state FROM incident_engine_runs WHERE id = ?")
        .bind(next.reservation_id)
        .first()) as any
    ).state,
  ).toBe("active");
});

test("DB constraints reject malformed JSON, null/missing required context, inconsistent PR and foreign keys", async () => {
  await f.reservation();
  for (const context of [
    "not-json",
    "{}",
    '{"llm":null,"fluent_bit":[]}',
    '{"llm":{"messages":[]},"fluent_bit":[]}',
    '{"llm":{"messages":[{}]},"fluent_bit":null}',
  ]) {
    await expect(
      f.db.prepare("UPDATE incidents SET context = ?").bind(context).run(),
    ).rejects.toThrow();
  }
  await expect(
    f.db.prepare("UPDATE incidents SET pr_generated = 1, pr_link = NULL").run(),
  ).rejects.toThrow();
  await expect(
    f.db.prepare("UPDATE incidents SET repo_id = 999").run(),
  ).rejects.toThrow();
});

test("Chat schema conditions match API including assistant tools/refusal and extra log fields", () => {
  const base = structuredClone(result) as any;
  for (const message of [
    {
      role: "assistant",
      tool_calls: [
        {
          id: "call",
          type: "function",
          function: { name: "f", arguments: "arbitrary string" },
        },
      ],
    },
    { role: "assistant", refusal: "no" },
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "tool", tool_call_id: "call", content: "value" },
  ]) {
    base.incident.context.llm.messages = [message];
    expect(envelope.safeParse(base).success).toBe(true);
  }
  for (const message of [
    { role: "assistant", content: null },
    { role: "assistant", refusal: "" },
    { role: "tool", content: "missing ID" },
  ]) {
    base.incident.context.llm.messages = [message];
    expect(envelope.safeParse(base).success).toBe(false);
  }
  expect(
    envelope.safeParse({
      incident: { ...result.incident, pr_generated: false },
    }).success,
  ).toBe(false);
});
