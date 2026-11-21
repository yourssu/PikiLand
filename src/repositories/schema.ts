import { z } from "zod";

export const repositoryId = z.int().positive();
export const params = z.object({ repo_id: repositoryId });
export const config = z
  .object({
    llm_base_url: z.url(),
    llm_api_key: z.string().openapi({ format: "password" }),
    llm_model_name: z.string().min(1),
    slack_webhook_url: z.url(),
    prod_server_url: z.url(),
    prod_server_token: z.string().openapi({ format: "password" }),
  })
  .catchall(z.unknown());
export type RepositoryConfig = z.infer<typeof config>;
export const repository = z.object({
  id: repositoryId,
  owner: z.string(),
  name: z.string(),
  branch: z.string(),
  is_active: z.boolean(),
});
export const createBody = z.object({
  installation_id: repositoryId,
  repo_id: repositoryId,
  branch: z.string(),
  config,
});
export const updateBody = z.strictObject({
  is_active: z.boolean(),
  branch: z.string(),
  config,
});
export const listQuery = z.object({
  page: z.int().min(1).default(1),
  per_page: z.int().min(1).max(30).default(10),
  filter_active: z.boolean().default(true),
});
export const pageStats = z.object({
  page: z.int().min(1),
  per_page: z.int().min(1).max(30),
  total_count: z.int().min(0),
  total_pages: z.int().min(0),
});
export const security = [{ cookieAuth: [] }];
export const errors = {
  "401": { description: "인증 실패" },
  "403": { description: "리포지토리 접근 또는 관리 권한 없음" },
};
