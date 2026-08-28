import { describe, expect, it, beforeEach } from "bun:test";
import { app } from "../src/index";
import { systemSettingsRepository } from "../src/db/repositories/system-settings.repository";
import { repoSettingsRepository } from "../src/db/repositories/repo-settings.repository";

describe("Settings & API Routes", () => {
  beforeEach(() => {
    process.env.DEBUG = "true";
  });

  it("should get and update global system settings", async () => {
    const updateReq = new Request("http://localhost:8080/api/settings/system", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubAppId: "998877",
        githubWebhookSecret: "super-secret-key",
        githubClientId: "client-id-123",
        globalAiModel: "claude-3-5-sonnet",
      }),
    });

    const updateRes = await app.request(updateReq);
    expect(updateRes.status).toBe(200);

    const getReq = new Request("http://localhost:8080/api/settings/system");
    const getRes = await app.request(getReq);
    expect(getRes.status).toBe(200);
    const data: any = await getRes.json();
    expect(data.githubAppId).toBe("998877");
    expect(data.globalAiModel).toBe("claude-3-5-sonnet");
  });

  it("should save and toggle repository settings", async () => {
    const saveReq = new Request("http://localhost:8080/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "yourssu/awesome-service",
        active: true,
        slackWebhookUrl: "https://hooks.slack.com/services/T00/B00/X00",
        customModel: "gpt-4o",
        harnessCmd: "./gradlew test",
        ralphMaxRetries: 5,
      }),
    });

    const res = await app.request(saveReq);
    expect(res.status).toBe(200);
    const saved: any = await res.json();
    expect(saved.fullName).toBe("yourssu/awesome-service");
    expect(saved.active).toBe(true);
    expect(saved.harnessStatus).toBe("ACTIVE");
    expect(saved.harnessCmd).toBe("./gradlew test");
    expect(saved.ralphMaxRetries).toBe(5);
  });

  it("should approve inferred harness command", async () => {
    repoSettingsRepository.save({
      repositoryFullName: "yourssu/inferred-service",
      active: true,
      inferredHarnessCmd: "pytest",
      harnessStatus: "PENDING_CONFIRMATION",
      harnessSource: "AUTO_INFERRED",
      ralphMaxRetries: 3,
    });

    const approveReq = new Request("http://localhost:8080/api/settings/harness/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName: "yourssu/inferred-service" }),
    });

    const res = await app.request(approveReq);
    expect(res.status).toBe(200);
    const updated: any = await res.json();
    expect(updated.harnessCmd).toBe("pytest");
    expect(updated.harnessStatus).toBe("ACTIVE");
  });

  it("should handle /api/logs/ingest strictly with repo-specific DB token", async () => {
    // 1. Missing X-Pikiland-Repo header
    const reqNoHeader = new Request("http://localhost:8080/api/logs/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-abc",
      },
      body: JSON.stringify({ log: "ERROR: database failed" }),
    });
    const resNoHeader = await app.request(reqNoHeader);
    expect(resNoHeader.status).toBe(400);

    // 2. Configure repo token in DB
    repoSettingsRepository.save({
      repositoryFullName: "yourssu/log-repo",
      active: true,
      harnessStatus: "NONE",
      harnessSource: "NONE",
      ralphMaxRetries: 3,
      logReceiverToken: "valid-repo-token-999",
    });

    // 3. Unauthorized token
    const reqInvalidToken = new Request("http://localhost:8080/api/logs/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pikiland-Repo": "yourssu/log-repo",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ log: "ERROR: database failed" }),
    });
    const resInvalidToken = await app.request(reqInvalidToken);
    expect(resInvalidToken.status).toBe(401);

    // 4. Authorized repo token
    const reqValid = new Request("http://localhost:8080/api/logs/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pikiland-Repo": "yourssu/log-repo",
        Authorization: "Bearer valid-repo-token-999",
      },
      body: JSON.stringify({ log: "ERROR: database connection timeout exception" }),
    });
    const resValid = await app.request(reqValid);
    expect(resValid.status).toBe(200);
    const data: any = await resValid.json();
    expect(data.status).toBe("success");
    expect(data.processed_records).toBe(1);

    // 5. Test Incident detail reverse lookup API
    const incidentsReq = new Request("http://localhost:8080/api/settings/incidents?repo=yourssu/log-repo");
    const incidentsRes = await app.request(incidentsReq);
    expect(incidentsRes.status).toBe(200);
    const incidentsList: any = await incidentsRes.json();
    expect(incidentsList.length).toBeGreaterThan(0);
    const incidentHash = incidentsList[0].hash;

    const detailReq = new Request(`http://localhost:8080/api/settings/incidents/detail?hash=${incidentHash}`, {
      headers: {
        Authorization: "Bearer ghs_runner_token_for_github_actions_123456",
      },
    });
    const detailRes = await app.request(detailReq);
    expect(detailRes.status).toBe(200);
    const detailData: any = await detailRes.json();
    expect(detailData.hash).toBe(incidentHash);
    expect(detailData.repositoryFullName).toBe("yourssu/log-repo");
    expect(detailData.rawLog).toContain("database connection timeout exception");
    expect(typeof detailData.firstSeenAt).toBe("string");
    expect(typeof detailData.lastSeenAt).toBe("string");
  });
});

describe("View Routes SSR Rendering", () => {
  it("should render Landing page HTML", async () => {
    const res = await app.request(new Request("http://localhost:8080/"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("PikiLand");
    expect(html).toContain("GitHub 계정으로 시작하기");
  });

  it("should render Dashboard page HTML", async () => {
    const res = await app.request(new Request("http://localhost:8080/dashboard"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("연동 저장소 목록");
    expect(html).toContain("대상 리포지토리 설정 가이드");
  });

  it("should render Admin page HTML for admin users in debug mode", async () => {
    const res = await app.request(new Request("http://localhost:8080/admin"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("중앙 시스템 설정");
    expect(html).toContain("GitHub App ID");
  });

  it("should render Setup page HTML", async () => {
    const res = await app.request(new Request("http://localhost:8080/setup"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("PikiLand GitHub App 설치 완료!");
  });

  it("should redirect /login to GitHub OAuth with /login/oauth2/code/github callback", async () => {
    systemSettingsRepository.saveGlobalSettings({
      githubClientId: "Ov23zTestClient123",
    });

    const res = await app.request(new Request("http://localhost:8080/login"));
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain("https://github.com/login/oauth/authorize");
    expect(location).toContain("client_id=Ov23zTestClient123");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Flogin%2Foauth2%2Fcode%2Fgithub");
  });
});
