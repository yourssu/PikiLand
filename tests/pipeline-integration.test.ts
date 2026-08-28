import { describe, expect, it, beforeEach } from "bun:test";
import { app } from "../src/index";
import { createHmac } from "crypto";
import { systemSettingsRepository } from "../src/db/repositories/system-settings.repository";
import { repoSettingsRepository } from "../src/db/repositories/repo-settings.repository";
import { logFingerprintRepository } from "../src/db/repositories/log-fingerprint.repository";

describe("E2E Pipeline Integration Tests", () => {
  const secret = "test-webhook-secret-e2e";
  const repoName = "yourssu/integration-test-repo";

  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    process.env.DEBUG = "false";
    process.env.PIKILAND_DEBUG = "false";

    systemSettingsRepository.saveGlobalSettings({
      githubWebhookSecret: secret,
      githubAppId: "12345",
      githubPrivateKeyContent: "mock-private-key",
      pikilandServerUrl: "https://pikiland.yourssu.com",
    });

    repoSettingsRepository.save({
      repositoryFullName: repoName,
      active: true,
      harnessCmd: "./gradlew test",
      harnessStatus: "ACTIVE",
      harnessSource: "USER_PROVIDED",
      ralphMaxRetries: 3,
      slackWebhookUrl: "https://hooks.slack.com/services/mock",
    });
  });

  it("should transition fingerprint lifecycle: IN_PROGRESS -> PR_CREATED -> RESOLVED", async () => {
    const testHash = "a1b2c3d4e5f67890123456789012345678901234567890123456789012345678";
    
    // 1. Initial fingerprint created
    logFingerprintRepository.save({
      hash: testHash,
      repositoryFullName: repoName,
      normalizedSignature: "NullPointerException in PipelineService",
      rawLog: "2026-08-28 ERROR: NullPointerException in PipelineService",
      state: "IN_PROGRESS",
      occurrenceCount: 1,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    const fpBefore = logFingerprintRepository.findByHash(testHash);
    expect(fpBefore?.state).toBe("IN_PROGRESS");

    // 2. PR Opened Webhook with branch pikiland/fix-<hash>
    const prOpenedPayload = JSON.stringify({
      action: "opened",
      pull_request: {
        head: { ref: `pikiland/fix-${testHash}` },
        body: `Automated patch for issue.\nPikiLand Incident Fingerprint: ${testHash}`,
        html_url: `https://github.com/${repoName}/pull/10`,
      },
      repository: { full_name: repoName },
    });

    const prOpenedSig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(prOpenedPayload, "utf8")).digest("hex");
    const prOpenedRes = await app.request(new Request("http://localhost:8080/api/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-Hub-Signature-256": prOpenedSig,
      },
      body: prOpenedPayload,
    }));
    expect(prOpenedRes.status).toBe(200);

    const fpAfterPr = logFingerprintRepository.findByHash(testHash);
    expect(fpAfterPr?.state).toBe("PR_CREATED");
    expect(fpAfterPr?.prUrl).toBe(`https://github.com/${repoName}/pull/10`);

    // 3. PR Merged Webhook (action: closed, merged: true)
    const prMergedPayload = JSON.stringify({
      action: "closed",
      pull_request: {
        head: { ref: `pikiland/fix-${testHash}` },
        body: `Automated patch for issue.\nPikiLand Incident Fingerprint: ${testHash}`,
        html_url: `https://github.com/${repoName}/pull/10`,
        merged: true,
      },
      repository: { full_name: repoName },
    });

    const prMergedSig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(prMergedPayload, "utf8")).digest("hex");
    const prMergedRes = await app.request(new Request("http://localhost:8080/api/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pull_request",
        "X-Hub-Signature-256": prMergedSig,
      },
      body: prMergedPayload,
    }));
    expect(prMergedRes.status).toBe(200);

    const fpAfterMerge = logFingerprintRepository.findByHash(testHash);
    expect(fpAfterMerge?.state).toBe("RESOLVED");
  });

  it("should transition fingerprint state to FAILED when pikiland self workflow fails", async () => {
    const testHash = "deadbeef12345678901234567890123456789012345678901234567890123456";

    logFingerprintRepository.save({
      hash: testHash,
      repositoryFullName: repoName,
      normalizedSignature: "DatabaseConnectionTimeout",
      rawLog: "ERROR DatabaseConnectionTimeout",
      state: "IN_PROGRESS",
      occurrenceCount: 1,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    const wfFailPayload = JSON.stringify({
      action: "completed",
      workflow_run: {
        id: 999999,
        conclusion: "failure",
        path: ".github/workflows/pikiland.yml",
        name: "PikiLand Self-Healing",
      },
      repository: { full_name: repoName },
    });

    const sig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(wfFailPayload, "utf8")).digest("hex");
    const res = await app.request(new Request("http://localhost:8080/api/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": sig,
      },
      body: wfFailPayload,
    }));
    expect(res.status).toBe(200);

    const fp = logFingerprintRepository.findByHash(testHash);
    expect(fp?.state).toBe("FAILED");
  });

  it("should create LogFingerprint with IN_PROGRESS state when target workflow_run fails", async () => {
    const runId = "555666";
    const wfFailPayload = JSON.stringify({
      action: "completed",
      workflow_run: {
        id: parseInt(runId, 10),
        conclusion: "failure",
        path: ".github/workflows/ci.yml",
        name: "Backend CI",
        head_branch: "main",
      },
      repository: { full_name: repoName, default_branch: "main" },
    });

    const sig = "sha256=" + createHmac("sha256", secret).update(Buffer.from(wfFailPayload, "utf8")).digest("hex");
    const res = await app.request(new Request("http://localhost:8080/api/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "workflow_run",
        "X-Hub-Signature-256": sig,
      },
      body: wfFailPayload,
    }));
    expect(res.status).toBe(200);

    const createdFp = logFingerprintRepository.findByHash(runId);
    expect(createdFp).not.toBeNull();
    expect(createdFp?.state).toBe("IN_PROGRESS");
    expect(createdFp?.repositoryFullName).toBe(repoName);
  });
});
