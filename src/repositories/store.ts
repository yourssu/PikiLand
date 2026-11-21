import { ForbiddenException, InternalServerErrorException } from "chanfana";
import type { AppContext } from "../types";
import type { RepositoryConfig } from "./schema";

export type RepositoryRow = {
  repo_id: number;
  installation_id: number;
  owner: string;
  name: string;
  branch: string;
  is_active: boolean;
  llm_base_url: string;
  llm_model_name: string;
  llm_api_key_ciphertext: string;
  slack_webhook_url_ciphertext: string;
  prod_server_url: string;
  prod_server_token_ciphertext: string;
  config_extra: string;
};
export const summary = (row: RepositoryRow) => ({
  id: row.repo_id,
  owner: row.owner,
  name: row.name,
  branch: row.branch,
  is_active: row.is_active === true,
});
export async function findRepository(c: AppContext, id: number) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM repositories WHERE repo_id = ?",
  )
    .bind(id)
    .first<RepositoryRow>();
  if (!row) throw new ForbiddenException();
  return row;
}

async function key(c: AppContext) {
  const secret = (
    c.env as CloudflareBindings & { REPOSITORY_ENCRYPTION_KEY?: string }
  ).REPOSITORY_ENCRYPTION_KEY;
  if (!secret) throw new InternalServerErrorException();
  try {
    const bytes = Uint8Array.from(atob(secret), (v) => v.charCodeAt(0));
    if (bytes.length !== 32) throw new Error("Invalid key");
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  } catch {
    throw new InternalServerErrorException();
  }
}
const encoder = new TextEncoder();
async function encrypt(c: AppContext, id: number, field: string, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(`${id}:${field}`) },
      await key(c),
      encoder.encode(text),
    ),
  );
  return `v1.${btoa(String.fromCharCode(...iv))}.${btoa(Array.from(ciphertext, (v) => String.fromCharCode(v)).join(""))}`;
}
async function decrypt(c: AppContext, id: number, field: string, text: string) {
  try {
    const [version, iv, ciphertext] = text.split(".");
    if (version !== "v1") throw new Error("Invalid ciphertext");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(atob(iv), (v) => v.charCodeAt(0)),
        additionalData: encoder.encode(`${id}:${field}`),
      },
      await key(c),
      Uint8Array.from(atob(ciphertext), (v) => v.charCodeAt(0)),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new InternalServerErrorException();
  }
}
export async function configValues(
  c: AppContext,
  id: number,
  config: RepositoryConfig,
) {
  const {
    llm_base_url,
    llm_api_key,
    llm_model_name,
    slack_webhook_url,
    prod_server_url,
    prod_server_token,
    ...extra
  } = config;
  return [
    llm_base_url,
    await encrypt(c, id, "llm_api_key", llm_api_key),
    llm_model_name,
    await encrypt(c, id, "slack_webhook_url", slack_webhook_url),
    prod_server_url,
    await encrypt(c, id, "prod_server_token", prod_server_token),
    JSON.stringify(extra),
  ];
}
export async function readConfig(c: AppContext, row: RepositoryRow) {
  return {
    ...JSON.parse(row.config_extra),
    llm_base_url: row.llm_base_url,
    llm_api_key: await decrypt(
      c,
      row.repo_id,
      "llm_api_key",
      row.llm_api_key_ciphertext,
    ),
    llm_model_name: row.llm_model_name,
    slack_webhook_url: await decrypt(
      c,
      row.repo_id,
      "slack_webhook_url",
      row.slack_webhook_url_ciphertext,
    ),
    prod_server_url: row.prod_server_url,
    prod_server_token: await decrypt(
      c,
      row.repo_id,
      "prod_server_token",
      row.prod_server_token_ciphertext,
    ),
  };
}
