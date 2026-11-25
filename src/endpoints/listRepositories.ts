import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { accessibleRepositories } from "../repositories/access";
import { summary, type RepositoryRow } from "../repositories/store";
import {
  errors,
  listQuery,
  pageStats,
  repository,
  security,
} from "../repositories/schema";

export class ListRepositories extends OpenAPIRoute {
  schema = {
    summary: "리포지토리 목록 조회",
    operationId: "listRepositories",
    security,
    tags: ["repositories"],
    request: { query: listQuery },
    responses: {
      "200": {
        description: "성공",
        ...contentJson(
          z.object({ repos: z.array(repository), page_stats: pageStats }),
        ),
      },
      ...errors,
    },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const access = await accessibleRepositories(c);
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM repositories ORDER BY repo_id",
    ).all<RepositoryRow>();
    const rows = results.filter(
      (row) =>
        access.get(row.installation_id)?.has(row.repo_id) &&
        (!query.filter_active || row.is_active === true),
    );
    const start = (query.page - 1) * query.per_page;
    return c.json({
      repos: rows.slice(start, start + query.per_page).map(summary),
      page_stats: {
        page: query.page,
        per_page: query.per_page,
        total_count: rows.length,
        total_pages: Math.ceil(rows.length / query.per_page),
      },
    });
  }
}
