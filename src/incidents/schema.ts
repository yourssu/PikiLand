import { z } from "zod";
import { contentJson } from "chanfana";
import { repositoryId } from "../repositories/schema";

const object = z.looseObject;
const date = z.iso.datetime({ offset: true });
const textContent = z.union([
  z.string(),
  z.array(object({ type: z.literal("text"), text: z.string() })).min(1),
]);
const functionCall = object({
  id: z.string(),
  type: z.literal("function"),
  function: object({ name: z.string(), arguments: z.string() }),
});
const assistantBase = {
  role: z.literal("assistant"),
  content: textContent.nullable().optional(),
  tool_calls: z.array(functionCall).min(1).optional(),
  name: z.string().optional(),
  refusal: z.string().nullable().optional(),
};
const assistant = z.union([
  object({ ...assistantBase, content: textContent }),
  object({ ...assistantBase, tool_calls: z.array(functionCall).min(1) }),
  object({ ...assistantBase, refusal: z.string().min(1) }),
]);
const message = z.union([
  ...(["system", "developer", "user"] as const).map((role) =>
    object({
      role: z.literal(role),
      content: textContent,
      name: z.string().optional(),
    }),
  ),
  assistant,
  object({
    role: z.literal("tool"),
    tool_call_id: z.string(),
    content: textContent,
  }),
]);
const tool = object({
  type: z.literal("function"),
  function: object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().nullable().optional(),
  }),
});
export const logBatch = z.array(object({ date }));
export const context = object({
  llm: object({
    messages: z.array(message).min(1),
    tools: z.array(tool).optional(),
  }),
  fluent_bit: logBatch,
});
const fields = { date, summary: z.string() };
const pr = [
  { pr_generated: z.literal(true), pr_link: z.url().min(1) },
  { pr_generated: z.literal(false), pr_link: z.null() },
] as const;
export const incidentDetail = z.union([
  object({ ...fields, ...pr[0], context }),
  object({ ...fields, ...pr[1], context }),
]);
export const incidentSummary = z.union([
  object({ id: repositoryId, ...fields, ...pr[0] }),
  object({ id: repositoryId, ...fields, ...pr[1] }),
]);
export const envelope = object({ incident: incidentDetail });
export type IncidentDetail = z.infer<typeof incidentDetail>;
export const incidentParams = z.object({
  repo_id: repositoryId,
  incident_id: repositoryId,
});
export const listQuery = z.object({
  page: z.int().min(1).default(1),
  per_page: z.int().min(1).max(30).default(10),
});
export const tokenRequest = z.strictObject({
  expires_in: z.int().min(1).max(21900),
});
export const tokenResponse = z.object({
  repo_id: repositoryId,
  token: z.string().min(1),
  token_type: z.literal("bearer"),
  purpose: z.literal("engine"),
  expires_in: z.int().min(1).max(21900),
  issued_at: date,
  expires_at: date,
});
export const engineErrors = {
  "401": {
    description: "유효한 Bearer 인증 필요",
    headers: z.object({ "WWW-Authenticate": z.string() }),
    ...contentJson(
      z.object({
        type: z.literal("about:blank"),
        title: z.literal("Unauthorized"),
        status: z.literal(401),
        detail: z.string(),
      }),
    ),
  },
  "403": {
    description: "repository 또는 실행 접근 권한 없음",
    ...contentJson(
      z.object({
        type: z.literal("about:blank"),
        title: z.literal("Forbidden"),
        status: z.literal(403),
        detail: z.string(),
      }),
    ),
  },
};
