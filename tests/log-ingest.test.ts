import { describe, expect, it, beforeEach } from "bun:test";
import { logIngestService } from "../src/services/log-ingest.service";
import { LogTruncator } from "../src/domain/log-truncator";
import { repoSettingsRepository } from "../src/db/repositories/repo-settings.repository";
import { logFingerprintRepository } from "../src/db/repositories/log-fingerprint.repository";

describe("LogTruncator", () => {
  const truncator = new LogTruncator();

  it("should return empty string for null or empty input", () => {
    expect(truncator.truncate("")).toBe("");
    expect(truncator.truncate(null)).toBe("");
  });

  it("should preserve short error logs without truncation", () => {
    const shortLog = "ERROR: Failed to connect to database at localhost:5432";
    expect(truncator.truncate(shortLog)).toBe(shortLog);
  });

  it("should strip ANSI escape sequences", () => {
    const ansiLog = "\u001b[31mERROR\u001b[0m: Test failed";
    expect(truncator.truncate(ansiLog)).toBe("ERROR: Test failed");
  });
});

describe("LogIngestService", () => {
  it("should detect genuine errors via regex matching", () => {
    expect(logIngestService.isGenuineError("2026-08-05 ERROR: NullPointerException in AuthService")).toBe(true);
    expect(logIngestService.isGenuineError("FATAL: Out of memory")).toBe(true);
    expect(logIngestService.isGenuineError("HTTP/1.1 500 Internal Server Error")).toBe(true);
    expect(logIngestService.isGenuineError("[503] Service Unavailable")).toBe(true);
    expect(logIngestService.isGenuineError("2026-08-05 INFO: Server started successfully on port 8080")).toBe(false);
  });

  it("should normalize log signature by stripping timestamps, threads, and trace IDs", () => {
    const raw = "2026-08-05 21:59:45.123 [http-nio-8080-exec-1] RequestId: req-12345 NullPointerException in UserRepo";
    const normalized = logIngestService.normalizeLogSignature(raw);
    expect(normalized).toBe("NullPointerException in UserRepo");
  });

  it("should compute deterministic SHA-256 hash", () => {
    const hash1 = logIngestService.computeSha256("NullPointerException in UserRepo");
    const hash2 = logIngestService.computeSha256("NullPointerException in UserRepo");
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it("should validate incident access for GitHub Action runner tokens (reverse log pulling)", () => {
    expect(logIngestService.validateIncidentAccess("yourssu/test-repo", "ghs_1234567890abcdefghijklmn")).toBe(true);
    expect(logIngestService.validateIncidentAccess("yourssu/test-repo", "ghp_1234567890abcdefghijklmn")).toBe(true);
    expect(logIngestService.validateIncidentAccess("yourssu/test-repo", "github_pat_1234567890abcdef")).toBe(true);
    expect(logIngestService.validateIncidentAccess("yourssu/test-repo", "")).toBe(false);

    // Test repo-specific token configured in DB
    repoSettingsRepository.save({
      repositoryFullName: "yourssu/custom-token-repo",
      active: true,
      harnessStatus: "NONE",
      harnessSource: "NONE",
      ralphMaxRetries: 3,
      logReceiverToken: "secret-custom-token-12345",
    });

    expect(logIngestService.validateIncidentAccess("yourssu/custom-token-repo", "secret-custom-token-12345")).toBe(true);
    expect(logIngestService.validateIncidentAccess("yourssu/custom-token-repo", "wrong-token")).toBe(false);
  });
});

describe("LlmLogClassifierService", () => {
  it("should accept genuine application errors with stack traces or error keywords", async () => {
    const { llmLogClassifierService } = await import("../src/services/llm-log-classifier.service");
    expect(llmLogClassifierService.isGenuineApplicationError("2026-08-28 ERROR: NullPointerException at com.example.Service(Service.java:42)")).toBe(true);
    expect(llmLogClassifierService.isGenuineApplicationError("HTTP/1.1 500 Internal Server Error")).toBe(true);
    expect(llmLogClassifierService.isGenuineApplicationError("panic: runtime error: invalid memory address or nil pointer dereference\ngoroutine 1 [running]:")).toBe(true);
  });

  it("should reject false positive non-error user inputs like simple 500 number", async () => {
    const { llmLogClassifierService } = await import("../src/services/llm-log-classifier.service");
    expect(llmLogClassifierService.isGenuineApplicationError("500")).toBe(false);
    expect(llmLogClassifierService.isGenuineApplicationError("search_query=500")).toBe(false);
    expect(llmLogClassifierService.isGenuineApplicationError("GET /api/v1/items?limit=500 HTTP/1.1\" 200")).toBe(false);
  });
});

describe("LogPathInferenceService", () => {
  it("should infer spring log path for spring boot project files", async () => {
    const { logPathInferenceService } = await import("../src/services/log-path-inference.service");
    expect(logPathInferenceService.inferLogPathFromFilenames(["application.yml", "src"])).toBe("/var/log/spring/*.log");
    expect(logPathInferenceService.inferLogPathFromFilenames(["logback-spring.xml", "build.gradle"])).toBe("/var/log/spring/*.log");
    expect(logPathInferenceService.inferLogPathFromFilenames(["build.gradle.kts", "gradlew"])).toBe("/var/log/spring/*.log");
    expect(logPathInferenceService.inferLogPathFromFilenames(["pom.xml", "mvnw"])).toBe("/var/log/spring/*.log");
  });

  it("should infer pm2 log path for node/pm2 projects", async () => {
    const { logPathInferenceService } = await import("../src/services/log-path-inference.service");
    expect(logPathInferenceService.inferLogPathFromFilenames(["pm2.config.js", "package.json"])).toBe("/var/log/pm2/*.log");
  });

  it("should infer docker log path for docker-compose projects", async () => {
    const { logPathInferenceService } = await import("../src/services/log-path-inference.service");
    expect(logPathInferenceService.inferLogPathFromFilenames(["docker-compose.yml", "Dockerfile"])).toBe("/var/log/docker/*.log");
  });

  it("should return default fallback log path for unknown projects", async () => {
    const { logPathInferenceService } = await import("../src/services/log-path-inference.service");
    expect(logPathInferenceService.inferLogPathFromFilenames([])).toBe("/var/log/production/*.log");
    expect(logPathInferenceService.inferLogPathFromFilenames(["README.md"])).toBe("/var/log/production/*.log");
  });

  it("should parse multiple alternative log field names in JSON payload (message, msg, @message, data)", async () => {
    const repo = "yourssu/test-multi-field-repo";
    repoSettingsRepository.save({
      repositoryFullName: repo,
      active: true,
      harnessStatus: "ACTIVE",
      harnessSource: "USER_PROVIDED",
      ralphMaxRetries: 3,
      logReceiverToken: "multi-field-token",
    });

    const count1 = await logIngestService.processIngestedLogs(repo, [
      { message: "2026-08-28 ERROR: NullPointerException in PaymentGateway" },
    ]);
    expect(count1).toBe(1);

    const count2 = await logIngestService.processIngestedLogs(repo, [
      { msg: "2026-08-28 FATAL: Out of memory in Worker" },
    ]);
    expect(count2).toBe(1);

    const count3 = await logIngestService.processIngestedLogs(repo, [
      { "@message": "2026-08-28 CRITICAL: Redis pool exhaustion" },
    ]);
    expect(count3).toBe(1);
  });
});
