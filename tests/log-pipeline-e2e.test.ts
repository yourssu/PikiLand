import { describe, expect, it, beforeEach } from "bun:test";
import { app } from "../src/index";
import { sqlite } from "../src/db/index";
import { repoSettingsRepository } from "../src/db/repositories/repo-settings.repository";
import { logFingerprintRepository } from "../src/db/repositories/log-fingerprint.repository";

describe("Log Pipeline E2E Tests (Ingest & Reverse Pull)", () => {
  const repoName = "yourssu/log-e2e-repo";
  const repoToken = "secret-log-token-xyz-123";

  beforeEach(() => {
    process.env.DEBUG = "false";
    process.env.PIKILAND_DEBUG = "false";

    sqlite.exec("DELETE FROM log_fingerprints; DELETE FROM repo_settings;");

    repoSettingsRepository.save({
      repositoryFullName: repoName,
      active: true,
      harnessStatus: "ACTIVE",
      harnessSource: "USER_PROVIDED",
      ralphMaxRetries: 3,
      logReceiverToken: repoToken,
      logIngestActive: true,
    });
  });

  it("should process multi-record Fluent Bit payload and deduplicate identical error streams", async () => {
    const errorLog1 = "2026-08-28 10:00:00.123 [http-nio-8080-exec-1] RequestId: req-111 ERROR: NullPointerException in OrderService:45";
    const errorLog2 = "2026-08-28 10:00:05.456 [http-nio-8080-exec-2] RequestId: req-222 ERROR: NullPointerException in OrderService:45";
    const infoLog = "2026-08-28 10:00:10.789 [http-nio-8080-exec-3] INFO: Order created successfully";

    const payload = [
      { log: errorLog1 },
      { log: infoLog },
      { log: errorLog2 },
    ];

    const ingestReq = new Request("http://localhost:8080/api/logs/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pikiland-Repo": repoName,
        Authorization: `Bearer ${repoToken}`,
      },
      body: JSON.stringify(payload),
    });

    const ingestRes = await app.request(ingestReq);
    expect(ingestRes.status).toBe(200);
    const ingestData: any = await ingestRes.json();
    expect(ingestData.status).toBe("success");
    // 2 error records processed (1 initial insert + 1 deduplication count increase)
    expect(ingestData.processed_records).toBe(2);

    // Verify DB deduplication
    const incidents = logFingerprintRepository.findAllByRepository(repoName);
    expect(incidents.length).toBe(1);
    expect(incidents[0].occurrenceCount).toBe(2);
    expect(incidents[0].state).toBe("IN_PROGRESS");
    expect(incidents[0].normalizedSignature).toContain("ERROR: NullPointerException in OrderService:45");
  });

  it("should support Reverse Log Pulling for GitHub Actions runner and reject unauthorized callers", async () => {
    const pullRepo = "yourssu/log-reverse-pull-repo";
    repoSettingsRepository.save({
      repositoryFullName: pullRepo,
      active: true,
      harnessStatus: "ACTIVE",
      harnessSource: "USER_PROVIDED",
      ralphMaxRetries: 3,
      logReceiverToken: repoToken,
      logIngestActive: true,
    });

    const errorLog = "2026-08-28 ERROR: Critical security violation in AuthGuard";
    
    // Ingest error
    const ingestRes = await app.request(new Request("http://localhost:8080/api/logs/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pikiland-Repo": pullRepo,
        Authorization: `Bearer ${repoToken}`,
      },
      body: JSON.stringify({ log: errorLog }),
    }));
    expect(ingestRes.status).toBe(200);

    const incidents = logFingerprintRepository.findAllByRepository(pullRepo);
    const hash = incidents[0].hash;

    // 1. Missing Authorization Header -> 401
    const resNoAuth = await app.request(new Request(`http://localhost:8080/api/settings/incidents/detail?hash=${hash}`));
    expect(resNoAuth.status).toBe(401);

    // 2. Invalid Token -> 403 Forbidden
    const resBadToken = await app.request(new Request(`http://localhost:8080/api/settings/incidents/detail?hash=${hash}`, {
      headers: { Authorization: "Bearer invalid-short-token" },
    }));
    expect(resBadToken.status).toBe(403);

    // 3. Valid Runner GHS Token -> 200 OK
    const resRunnerToken = await app.request(new Request(`http://localhost:8080/api/settings/incidents/detail?hash=${hash}`, {
      headers: { Authorization: "Bearer ghs_runner_temp_token_for_actions_001" },
    }));
    expect(resRunnerToken.status).toBe(200);
    const detail: any = await resRunnerToken.json();
    expect(detail.hash).toBe(hash);
    expect(detail.repositoryFullName).toBe(pullRepo);
    expect(detail.rawLog).toContain("Critical security violation in AuthGuard");

    // 4. Non-existent hash -> 404
    const resNotFound = await app.request(new Request(`http://localhost:8080/api/settings/incidents/detail?hash=nonexistenthash123`, {
      headers: { Authorization: "Bearer ghs_runner_temp_token_for_actions_001" },
    }));
    expect(resNotFound.status).toBe(404);
  });
});
