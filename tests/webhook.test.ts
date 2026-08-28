import { describe, expect, it, beforeEach } from "bun:test";
import { app } from "../src/index";
import { createHmac } from "crypto";
import { systemSettingsRepository } from "../src/db/repositories/system-settings.repository";

describe("Webhook Routes", () => {
  const secret = "test-webhook-secret";

  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    process.env.DEBUG = "false";
    process.env.PIKILAND_DEBUG = "false";
    systemSettingsRepository.saveGlobalSettings({
      githubWebhookSecret: secret,
    });
  });

  it("should reject webhook request with invalid signature", async () => {
    const payload = JSON.stringify({ action: "completed" });
    const req = new Request("http://localhost:8080/api/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": "sha256=invalid_signature_hex_value",
      },
      body: payload,
    });

    const res = await app.request(req);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Invalid signature");
  });

  it("should accept webhook request with valid HMAC-SHA256 signature", async () => {
    const payload = JSON.stringify({
      action: "completed",
      workflow_run: {
        id: 123456,
        conclusion: "failure",
        path: ".github/workflows/ci.yml",
        name: "CI Build",
      },
      repository: {
        full_name: "yourssu/test-repo",
        default_branch: "main",
      },
      installation: {
        id: 9999,
      },
    });

    const signature = "sha256=" + createHmac("sha256", secret).update(payload, "utf8").digest("hex");

    const req = new Request("http://localhost:8080/api/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": signature,
      },
      body: payload,
    });

    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Accepted");
  });

  it("should accept issue webhook without loop on self-generated issue", async () => {
    const payload = JSON.stringify({
      action: "opened",
      issue: {
        number: 42,
        title: "PikiLand Incident",
        body: "Created automatically by PikiLand AI Self-Healing Engine",
      },
      repository: {
        full_name: "yourssu/test-repo",
      },
      installation: {
        id: 9999,
      },
    });

    const signature = "sha256=" + createHmac("sha256", secret).update(payload, "utf8").digest("hex");

    const req = new Request("http://localhost:8080/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issues",
        "X-Hub-Signature-256": signature,
      },
      body: payload,
    });

    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Accepted");
  });

  it("should accept webhook request with multibyte Korean characters and emojis", async () => {
    const payload = JSON.stringify({
      action: "opened",
      issue: {
        number: 101,
        title: "🚨 [긴급 장애] 데이터베이스 연결 실패 및 NullPointer 예외 발생! 🐛",
        body: "사용자 로그인 시 `UserAuthService.java:42`에서 NullPointerException 발생 💥\n재현 경로: /api/v1/auth/login",
      },
      repository: {
        full_name: "yourssu/korean-service-repo",
      },
      installation: {
        id: 8888,
      },
    });

    const signature = "sha256=" + createHmac("sha256", secret).update(Buffer.from(payload, "utf8")).digest("hex");

    const req = new Request("http://localhost:8080/api/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issues",
        "X-Hub-Signature-256": signature,
      },
      body: payload,
    });

    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Accepted");
  });
});
