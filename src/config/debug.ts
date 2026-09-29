function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Skips webhook signature verification and repo-ownership authorization.
 * Broad bypass — never usable when NODE_ENV=production, regardless of value.
 */
export function isDebugMode(): boolean {
  if (isProductionEnv()) return false;
  return process.env.DEBUG === "true" || process.env.PIKILAND_DEBUG === "true";
}

/**
 * Skips only the GitHub OAuth session requirement so the dashboard/admin
 * screens can be opened directly for manual UI checks or Playwright tests.
 * Does not affect webhook verification or repo-ownership checks.
 * Never usable when NODE_ENV=production, regardless of value.
 */
export function isUiPreviewMode(): boolean {
  if (isProductionEnv()) return false;
  return process.env.PIKILAND_UI_PREVIEW === "true" || isDebugMode();
}
