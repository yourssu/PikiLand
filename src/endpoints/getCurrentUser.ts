import {
  InternalServerErrorException,
  OpenAPIRoute,
  UnauthorizedException,
} from "chanfana";
import { z } from "zod";
import { type AppContext } from "../types";

export class GetCurrentUser extends OpenAPIRoute {
  schema = {
    summary: "현재 사용자 및 GitHub 연결 정보 조회",
    operationId: "GetCurrentUser",
    security: [{ cookieAuth: [] }],
    tags: ["users"],
    responses: {
      "200": {
        description: "성공",
        content: {
          "application/json": {
            schema: z.object({
              id: z
                .int()
                .describe("GitHub 사용자 고유 아이디")
                .openapi({ example: 1234567 }),
              login: z
                .string()
                .describe("GitHub 사용자명")
                .openapi({ example: "yourssu" }),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const id = c.get("id");

    const access_token = await c.env.DB.prepare(
      "SELECT github_access_token FROM sessions WHERE id = ? and expires_at > datetime('now')",
    )
      .bind(id)
      .first<{ github_access_token: string }>();
    if (!access_token) throw new UnauthorizedException();

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "PikiLand-Coordinator",
      },
    });

    if (!userResponse.ok) throw new InternalServerErrorException();

    const { login } = (await userResponse.json()) as {
      login?: unknown;
    };

    if (typeof login !== "string") throw new InternalServerErrorException();

    return c.json({ id, login }, 200);
  }
}
