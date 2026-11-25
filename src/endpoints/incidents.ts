import { ForbiddenException, OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { authorize } from "../repositories/access";
import { findRepository } from "../repositories/store";
import {
  errors,
  pageStats,
  params,
  repositoryId,
  security,
} from "../repositories/schema";
import {
  engineErrors,
  envelope,
  incidentParams,
  incidentSummary,
  listQuery,
} from "../incidents/schema";
import {
  detail,
  getIncident,
  replaceIncident,
  type IncidentRow,
} from "../incidents/store";
import { authenticateEngine, deny } from "../incidents/engineAuth";

async function authorizeIncident(c: AppContext, repo: number, manage = false) {
  const row = await findRepository(c, repo);
  await authorize(c, row.installation_id, row.repo_id, manage);
}
export class ListIncidents extends OpenAPIRoute {
  schema = {
    summary: "리포지토리 사건 목록 조회",
    operationId: "listIncidents",
    tags: ["incidents"],
    security,
    request: { params, query: listQuery },
    responses: {
      "200": {
        description: "성공",
        ...contentJson(
          z.object({
            incidents: z.array(incidentSummary),
            page_stats: pageStats,
          }),
        ),
      },
      ...errors,
    },
  };
  async handle(c: AppContext) {
    const { params, query } = await this.getValidatedData<typeof this.schema>();
    await authorizeIncident(c, params.repo_id);
    const [count, rows] = await c.env.DB.batch([
      c.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM incidents WHERE repo_id = ?",
      ).bind(params.repo_id),
      c.env.DB.prepare(
        `SELECT incident_id, occurred_at, pr_generated, pr_link, summary FROM incidents WHERE repo_id = ?
        ORDER BY occurred_at DESC, incident_id DESC LIMIT ? OFFSET ?`,
      ).bind(params.repo_id, query.per_page, (query.page - 1) * query.per_page),
    ]);
    const total = Number((count.results[0] as { count: number }).count);
    return c.json({
      incidents: (rows.results as unknown as IncidentRow[]).map((row) => ({
        id: row.incident_id,
        date: row.occurred_at,
        pr_generated: row.pr_generated === 1,
        pr_link: row.pr_link,
        summary: row.summary,
      })),
      page_stats: {
        page: query.page,
        per_page: query.per_page,
        total_count: total,
        total_pages: Math.ceil(total / query.per_page),
      },
    });
  }
}
export class GetIncident extends OpenAPIRoute {
  schema = {
    summary: "사건 상세 조회",
    operationId: "getIncident",
    tags: ["incidents"],
    security,
    request: { params: incidentParams },
    responses: {
      "200": { description: "성공", ...contentJson(envelope) },
      ...errors,
    },
  };
  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    await authorizeIncident(c, params.repo_id);
    return c.json({
      incident: detail(
        await getIncident(c.env.DB, params.repo_id, params.incident_id),
      ),
    });
  }
}
export class DeleteIncident extends OpenAPIRoute {
  schema = {
    summary: "사건 삭제",
    operationId: "deleteIncident",
    tags: ["incidents"],
    security,
    request: { params: incidentParams },
    responses: {
      "200": {
        description: "성공",
        ...contentJson(z.object({ incident_id: repositoryId })),
      },
      ...errors,
    },
  };
  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    await authorizeIncident(c, params.repo_id, true);
    const row = await c.env.DB.prepare(
      "DELETE FROM incidents WHERE repo_id = ? AND incident_id = ? RETURNING incident_id",
    )
      .bind(params.repo_id, params.incident_id)
      .first<{ incident_id: number }>();
    if (!row) throw new ForbiddenException();
    return c.json(row);
  }
}
export class UpdateEngineIncident extends OpenAPIRoute {
  schema = {
    summary: "엔진에 연결된 사건 전체 덮어쓰기",
    operationId: "createIncident",
    tags: ["incidents"],
    security: [{ RepositoryBearer: [] }],
    request: { params, body: contentJson(envelope) },
    responses: {
      "201": {
        description: "사건 수정 완료; 본문 없음",
        headers: z.object({ Location: z.string() }),
      },
      ...engineErrors,
    },
  };
  async handle(c: AppContext) {
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const hash = await authenticateEngine(c, params.repo_id);
    const row = await replaceIncident(
      c.env.DB,
      params.repo_id,
      hash,
      body.incident,
    );
    if (!row) deny(401);
    c.header(
      "Location",
      `/api/repositories/${params.repo_id}/incidents/${row.incident_id}`,
    );
    return c.body(null, 201);
  }
}
