import { describe, expect, it, beforeEach } from "bun:test";
import { app } from "../src/index";
import { repoSettingsRepository } from "../src/db/repositories/repo-settings.repository";

describe("RBAC & Auth Tests", () => {
  beforeEach(() => {
    process.env.DEBUG = "false";
    process.env.PIKILAND_DEBUG = "false";
    process.env.PIKILAND_ADMIN_USERS = "admin-user,super-admin";
  });

  function createSessionCookie(username: string, accessToken = "gho_mock_token_123"): string {
    const payload = JSON.stringify({ username, accessToken });
    return `pikiland_session=${Buffer.from(payload).toString("base64")}`;
  }

  it("should forbid non-admin user from accessing /admin and /api/settings/system", async () => {
    const regularUserCookie = createSessionCookie("normal-dev");

    // 1. GET /admin with regular user
    const adminPageRes = await app.request(new Request("http://localhost:8080/admin", {
      headers: { Cookie: regularUserCookie },
    }));
    expect(adminPageRes.status).toBe(403);

    // 2. GET /api/settings/system with regular user
    const systemGetRes = await app.request(new Request("http://localhost:8080/api/settings/system", {
      headers: { Cookie: regularUserCookie },
    }));
    expect(systemGetRes.status).toBe(403);

    // 3. POST /api/settings/system with regular user
    const systemPostRes = await app.request(new Request("http://localhost:8080/api/settings/system", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: regularUserCookie,
      },
      body: JSON.stringify({ githubAppId: "999" }),
    }));
    expect(systemPostRes.status).toBe(403);
  });

  it("should allow admin user to access /admin and /api/settings/system", async () => {
    const adminCookie = createSessionCookie("admin-user");

    const adminPageRes = await app.request(new Request("http://localhost:8080/admin", {
      headers: { Cookie: adminCookie },
    }));
    expect(adminPageRes.status).toBe(200);

    const systemGetRes = await app.request(new Request("http://localhost:8080/api/settings/system", {
      headers: { Cookie: adminCookie },
    }));
    expect(systemGetRes.status).toBe(200);
  });

  it("should prevent normal user from modifying other user's repository settings", async () => {
    repoSettingsRepository.save({
      repositoryFullName: "other-org/victim-repo",
      active: true,
      harnessStatus: "ACTIVE",
      harnessSource: "USER_PROVIDED",
      ralphMaxRetries: 3,
    });

    const attackerCookie = createSessionCookie("attacker-user");

    const modifyRes = await app.request(new Request("http://localhost:8080/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: attackerCookie,
      },
      body: JSON.stringify({
        fullName: "other-org/victim-repo",
        active: false,
        slackWebhookUrl: "https://attacker-webhook.com",
      }),
    }));

    expect(modifyRes.status).toBe(403);
  });

  it("should allow repository owner to modify own repository settings", async () => {
    const ownerCookie = createSessionCookie("my-username");

    const modifyRes = await app.request(new Request("http://localhost:8080/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: ownerCookie,
      },
      body: JSON.stringify({
        fullName: "my-username/my-cool-project",
        active: true,
        harnessCmd: "bun test",
        ralphMaxRetries: 5,
      }),
    }));

    expect(modifyRes.status).toBe(200);
    const updated: any = await modifyRes.json();
    expect(updated.fullName).toBe("my-username/my-cool-project");
    expect(updated.active).toBe(true);
    expect(updated.harnessCmd).toBe("bun test");
  });

  it("should reject incident detail access with invalid long dummy token (IDOR Guard)", async () => {
    const detailRes = await app.request(new Request("http://localhost:8080/api/settings/incidents/detail?hash=somehash", {
      headers: {
        Authorization: "Bearer dummy_random_token_longer_than_20_chars",
      },
    }));

    expect(detailRes.status).not.toBe(200);
  });
});
