import { test, expect } from "@playwright/test";
import { loginAs } from "./support/auth";

test.describe("page rendering", () => {
  test("landing page shows the login CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".main-title")).toHaveText("PikiLand");
    await expect(page.getByRole("link", { name: /GitHub 계정으로 시작하기/ })).toBeVisible();
  });

  test("dashboard renders via PIKILAND_UI_PREVIEW without any session cookie", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".logo")).toContainText("PikiLand");
    await expect(page.getByText("연동 저장소 목록")).toBeVisible();
  });

  test("setup page renders", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByText("설치 완료")).toBeVisible();
  });

  test("admin page is forbidden for a real session that isn't in PIKILAND_ADMIN_USERS", async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAs(context, baseURL!, { username: "regular-user" });
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(403);
  });

  test("admin page renders for a real session matching PIKILAND_ADMIN_USERS", async ({
    page,
    context,
    baseURL,
  }) => {
    // Matches PIKILAND_ADMIN_USERS in playwright.config.ts's webServer.env.
    await loginAs(context, baseURL!, { username: "e2e-admin" });
    await page.goto("/admin");
    await expect(page.getByText("중앙 시스템 설정")).toBeVisible();
  });
});

test.describe("theme toggle", () => {
  test("switches data-theme and persists across reload", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: /모드로 전환/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
