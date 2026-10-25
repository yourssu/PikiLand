import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { type AppContext } from "../types";

export class IncidentCreate extends OpenAPIRoute {
  schema = {
    tags: ["Incidents"],
    summary: "Create new incident",
    description:
      "시스템 장애나 보안 이슈 등의 인시던트를 신규 등록합니다. 요청 본문에는 장애가 발생한 대상 리포지토리 이름을 포함해야 하며, 인증된 사용자만 생성할 수 있습니다.",
    security: [{ bearerAuth: [] }],
    request: {
      body: contentJson(
        z.object({
          repo_name: z
            .string()
            .trim()
            .min(1, { message: "리포지토리 이름은 필수 항목입니다." })
            .max(100, {
              message: "리포지토리 이름은 최대 100자 이하로 입력해주세요.",
            })
            .regex(/^[\w.-]+\/[\w.-]+$/, {
              message: "올바른 리포지토리 형식(owner/repo)이 아닙니다.",
            })
            .describe(
              "장애가 발생한 GitHub 또는 자체 Git 저장소의 풀 네임 (예: 'my-org/my-repo')",
            )
            .openapi({ example: "yourssu/pikiland" }),
        }),
      ),
    },
    responses: {
      "200": {
        description:
          "성공: 인시던트가 시스템에 성공적으로 등록되었으며, 고유 식별자(UUID)를 반환합니다.",
        content: {
          "application/json": {
            schema: z.object({
              id: z
                .uuid({ message: "올바른 UUID 형식이 아닙니다." })
                .describe(
                  "생성된 인시던트를 추적하고 조회할 수 있는 시스템 고유 식별자 (v4 UUID 포맷)",
                ),
            }),
          },
        },
      },
      "401": {
        description:
          "실패: 요청 헤더에 유효한 Bearer 토큰이 누락되었거나 만료되어 인증에 실패한 상태입니다.",
        content: {
          "text/plain": {
            schema: z
              .string()
              .openapi({ example: "Unauthorized: Token expired" }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    // c.env.DB.exec("awesome sql command");
    return c.json(
      {
        id: crypto.randomUUID(),
      },
      201,
    );
  }
}
