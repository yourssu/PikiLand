import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { params } from "../repositories/schema";
import { engineErrors, tokenRequest, tokenResponse } from "../incidents/schema";
import { authenticateOidc, issueEngineToken } from "../incidents/engineAuth";

export class CreateEngineToken extends OpenAPIRoute {
  schema = {
    summary: "OIDC engine 토큰 발급·교체",
    operationId: "genenginetoken",
    tags: ["engine"],
    security: [{ GitHubActionsOIDC: [] }],
    request: { params, body: contentJson(tokenRequest) },
    responses: {
      "201": {
        description: "발급됨",
        headers: z.object({ "Cache-Control": z.literal("no-store") }),
        ...contentJson(tokenResponse),
      },
      ...engineErrors,
    },
  };
  async handle(c: AppContext) {
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const identity = await authenticateOidc(c, params.repo_id);
    const response = await issueEngineToken(
      c,
      params.repo_id,
      body.expires_in,
      identity,
    );
    c.header("Cache-Control", "no-store");
    return c.json(response, 201);
  }
}
