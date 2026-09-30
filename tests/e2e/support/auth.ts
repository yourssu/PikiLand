import type { BrowserContext } from "@playwright/test";

/**
 * Injects a `pikiland_session` cookie in the exact format `auth.routes.ts`
 * decodes (base64 JSON), exercising the real cookie-auth code path instead
 * of the PIKILAND_UI_PREVIEW bypass. Use this whenever a test needs to
 * assert admin-only vs regular-user behavior; use PIKILAND_UI_PREVIEW
 * (already on for the whole e2e run, see playwright.config.ts) for tests
 * that just need any page to render without caring who's "logged in".
 */
export async function loginAs(
  context: BrowserContext,
  baseURL: string,
  user: { username: string; accessToken?: string }
): Promise<void> {
  const payload = JSON.stringify({
    username: user.username,
    accessToken: user.accessToken ?? "e2e-mock-token",
  });
  const value = Buffer.from(payload).toString("base64");
  const { hostname } = new URL(baseURL);

  await context.addCookies([
    {
      name: "pikiland_session",
      value,
      domain: hostname,
      path: "/",
    },
  ]);
}
