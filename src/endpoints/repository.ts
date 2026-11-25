import { ForbiddenException, OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { authorize } from "../repositories/access";
import {
  configValues,
  findRepository,
  readConfig,
  summary,
} from "../repositories/store";
import {
  config,
  createBody,
  errors,
  params,
  repository,
  repositoryId,
  security,
  updateBody,
} from "../repositories/schema";

const idResponse = contentJson(z.object({ repo_id: repositoryId }));

export class CreateRepository extends OpenAPIRoute {
  schema = {
    summary: "리포지토리 추가",
    operationId: "createRepository",
    tags: ["repositories"],
    security,
    request: { body: contentJson(createBody) },
    responses: {
      "201": {
        description: "생성됨",
        ...contentJson(z.object({ repo: repository })),
        headers: z.object({
          Location: z.string().describe("생성된 리소스 상세 조회 URI"),
        }),
      },
      ...errors,
    },
  };
  async handle(c: AppContext) {
    const { body } = await this.getValidatedData<typeof this.schema>();
    const github = await authorize(c, body.installation_id, body.repo_id, true);
    const values = await configValues(c, body.repo_id, body.config);
    const result = await c.env.DB.prepare(
      `INSERT INTO repositories
      (repo_id, installation_id, owner, name, branch, llm_base_url, llm_api_key_ciphertext,
       llm_model_name, slack_webhook_url_ciphertext, prod_server_url, prod_server_token_ciphertext, config_extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(repo_id) DO NOTHING`,
    )
      .bind(
        body.repo_id,
        body.installation_id,
        github.owner.login,
        github.name,
        body.branch,
        ...values,
      )
      .run();
    if (!result.meta.changes) throw new ForbiddenException();
    c.header("Location", `/api/repositories/${body.repo_id}`);
    return c.json(
      {
        repo: {
          id: body.repo_id,
          owner: github.owner.login,
          name: github.name,
          branch: body.branch,
          is_active: true,
        },
      },
      201,
    );
  }
}

export class GetRepository extends OpenAPIRoute {
  schema = {
    summary: "리포지토리 정보 및 설정 조회",
    operationId: "getRepository",
    tags: ["repositories"],
    security,
    request: { params },
    responses: {
      "200": {
        description: "성공",
        ...contentJson(z.object({ repo: repository, config })),
      },
      ...errors,
    },
  };
  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const row = await findRepository(c, params.repo_id);
    await authorize(c, row.installation_id, row.repo_id);
    return c.json({ repo: summary(row), config: await readConfig(c, row) });
  }
}

export class UpdateRepository extends OpenAPIRoute {
  schema = {
    summary: "리포지토리 설정 변경",
    operationId: "updateRepository",
    tags: ["repositories"],
    security,
    description:
      "is_active, branch, config를 전체 교체합니다. 누락은 허용하지 않습니다.",
    request: { params, body: contentJson(updateBody) },
    responses: { "200": { description: "성공", ...idResponse }, ...errors },
  };
  async handle(c: AppContext) {
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const row = await findRepository(c, params.repo_id);
    await authorize(c, row.installation_id, row.repo_id, true);
    const values = await configValues(c, row.repo_id, body.config);
    const result = await c.env.DB.prepare(
      `UPDATE repositories SET is_active = ?, branch = ?,
      llm_base_url = ?, llm_api_key_ciphertext = ?, llm_model_name = ?, slack_webhook_url_ciphertext = ?,
      prod_server_url = ?, prod_server_token_ciphertext = ?, config_extra = ?
      WHERE repo_id = ? AND installation_id = ?`,
    )
      .bind(
        Number(body.is_active),
        body.branch,
        ...values,
        row.repo_id,
        row.installation_id,
      )
      .run();
    if (!result.meta.changes) throw new ForbiddenException();
    return c.json({ repo_id: row.repo_id });
  }
}

export class DeleteRepository extends OpenAPIRoute {
  schema = {
    summary: "리포지토리 삭제",
    operationId: "deleteRepository",
    tags: ["repositories"],
    security,
    request: { params },
    responses: { "200": { description: "성공", ...idResponse }, ...errors },
  };
  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const row = await findRepository(c, params.repo_id);
    await authorize(c, row.installation_id, row.repo_id, true);
    const result = await c.env.DB.prepare(
      "DELETE FROM repositories WHERE repo_id = ? AND installation_id = ?",
    )
      .bind(row.repo_id, row.installation_id)
      .run();
    if (!result.meta.changes) throw new ForbiddenException();
    return c.json({ repo_id: row.repo_id });
  }
}
