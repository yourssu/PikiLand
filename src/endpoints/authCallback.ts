import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { type AppContext } from "../types";
import { sign } from "hono/jwt";

export class AuthCallback extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Callback for GitHub Auth",
    description:
      "GitHub OAuth 웹 흐름(Web Flow)의 리다이렉트 콜백을 처리합니다. 전달받은 authorization code를 사용해 서비스 전용 JWT 액세스 토큰을 발급합니다.",
    request: {
      query: z.object({
        code: z
          .string()
          .min(1, { message: "GitHub 인증 코드는 필수 파라미터입니다." })
          .regex(/^[a-f0-9]+$/i, {
            message: "올바른 16진수 형식의 인증 코드가 아닙니다.",
          }) // GitHub code 특성에 맞는 정규식 예시
          .describe(
            "GitHub OAuth 승인 과정에서 리다이렉트 시 쿼리 스트링으로 전달되는 20자 내외의 Authorization Code",
          ),
      }),
    },
    responses: {
      "200": {
        description:
          "성공: GitHub 인증이 완료되었으며, 이후 API 요청에 사용할 자체 JWT 액세스 토큰을 반환합니다.",
        content: {
          "application/json": {
            schema: z.object({
              access_token: z
                .string()
                .describe(
                  "인증된 사용자의 세션을 유지하기 위한 Bearer 형태의 JWT 액세스 토큰 (유효기간: 1시간)",
                ),
            }),
          },
        },
      },
      "401": {
        description:
          "실패: 유효하지 않거나 만료된 GitHub 인증 코드 사용, 또는 GitHub API 서버와의 통신 실패 시 발생합니다.",
        content: {
          "text/plain": {
            schema: z
              .string()
              .describe(
                "에러 원인을 설명하는 평문 메시지 (예: 'Invalid authorization code')",
              ),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { code } = data.query;
    if (!code) {
      return c.text("code not provided", 401);
    }

    try {
      const form = new URLSearchParams({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
      });

      const tokenResp = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form,
        },
      );

      if (!tokenResp.ok) return c.text("token fetch failed", 401);

      const tokenData = (await tokenResp.json()) as {
        access_token?: string;
        error?: string;
      };

      if (!tokenData.access_token || tokenData.error) {
        return c.text("access_token invalid", 401);
      }

      const userResp = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (!userResp.ok) return c.text("user fetch failed", 401);

      const user = (await userResp.json()) as {
        id: number;
        login: string;
      };

      const jwt = await sign(
        {
          sub: String(user.id),
          login: user.login,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        c.env.JWT_SECRET,
        "HS256",
      );

      return c.json({ access_token: jwt }, 200);
    } catch {
      return c.text("unknown error", 401);
    }
  }
}
