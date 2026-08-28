import { createHash } from "crypto";
import { logFingerprintRepository } from "../db/repositories/log-fingerprint.repository";
import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";
import { selfHealingService } from "./self-healing.service";
import { githubAuthService } from "./github-auth.service";
import { llmLogClassifierService } from "./llm-log-classifier.service";
import { LogFingerprint } from "../domain/models";

export class LogIngestService {
  private static readonly RULE_ERROR_PATTERN =
    /(ERROR|EXCEPTION|FATAL|CRITICAL|PANIC|UNHANDLED|FAIL|SEVERE|TRACEBACK|NULLPOINTER|STACKTRACE|STATUSCODE=5|HTTP\/1\.[01] 5|HTTP\/2 5|\[5\d{2}\])/i;

  public async processIngestedLogs(targetRepoHeader: string | null | undefined, payloads: Array<Record<string, any>>): Promise<number> {
    if (!payloads || payloads.length === 0) {
      return 0;
    }

    const repoFullName = this.resolveTargetRepo(targetRepoHeader);
    if (!repoFullName) {
      console.warn("[LogIngest] No active target repository found for ingested logs.");
      return 0;
    }

    let processedCount = 0;

    for (const entry of payloads) {
      const rawLog = String(entry.log || entry.message || entry.msg || entry["@message"] || entry.data || "");
      if (!rawLog || rawLog.trim().length === 0) {
        continue;
      }

      // Stage 1: Rule-based Error Verification
      if (!this.isGenuineError(rawLog)) {
        console.log("[LogIngest] Log entry rejected (does not match error signature).");
        continue;
      }

      // Stage 2: LLM / Heuristic 진위 검증 (단순 500 파라미터나 비에러 사용자 입력 필터링)
      if (!llmLogClassifierService.isGenuineApplicationError(rawLog)) {
        console.log("[LogIngest] Log entry rejected by LLM classifier (false positive / user input).");
        continue;
      }

      // Fast Stage: Pre-check if error fingerprint is already active & IN_PROGRESS in DB
      const normalizedSignature = this.normalizeLogSignature(rawLog);
      const hash = this.computeSha256(normalizedSignature);

      const existing = logFingerprintRepository.findByHash(hash);
      if (existing && existing.state === "IN_PROGRESS") {
        existing.occurrenceCount += 1;
        existing.lastSeenAt = new Date();
        logFingerprintRepository.save(existing);
        console.log(`[LogIngest] Deduplicated active error log. Hash: ${hash}, Count: ${existing.occurrenceCount}`);
        processedCount++;
        continue;
      }

      // Create new or re-opened fingerprint
      const fingerprint: LogFingerprint = {
        hash,
        repositoryFullName: repoFullName,
        normalizedSignature,
        rawLog,
        state: "IN_PROGRESS",
        occurrenceCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      };
      logFingerprintRepository.save(fingerprint);

      console.log(`[LogIngest] 🚀 Genuine Error Detected! Triggering Self-Healing for Repo: '${repoFullName}', Hash: ${hash}`);

      // Resolve real default branch for target repository
      const defaultBranch = await githubAuthService.getDefaultBranchForRepo(repoFullName);

      // Trigger Self-Healing Pipeline asynchronously
      selfHealingService.runSelfHealing({
        repoName: repoFullName,
        rawLogOrIssueBody: rawLog,
        eventType: "production_log",
        runId: hash,
        installationId: 0,
        targetBranch: defaultBranch,
        defaultBranch,
      });

      processedCount++;
    }

    return processedCount;
  }

  public isGenuineError(rawLog: string): boolean {
    if (!rawLog || rawLog.trim().length === 0) return false;
    return LogIngestService.RULE_ERROR_PATTERN.test(rawLog);
  }

  public normalizeLogSignature(rawLog: string): string {
    if (!rawLog) return "";

    // 1. Remove timestamps: e.g. 2026-08-05 21:59:45.123, 2026-08-05T21:59:45Z
    let normalized = rawLog.replace(
      /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g,
      ""
    );

    // 2. Remove Thread names: e.g. [http-nio-8080-exec-1], [main]
    normalized = normalized.replace(/\[[^\]]+\]/g, "");

    // 3. Remove Request/Trace IDs: e.g. RequestId: req-12345, trace_id=abcxyz
    normalized = normalized.replace(/(request|trace|span)[_-]?id[:=\s]+\S+/gi, "");

    // 4. Trim whitespace
    return normalized.replace(/\s+/g, " ").trim();
  }

  public getIncidentsForRepository(repoFullName: string): LogFingerprint[] {
    if (!repoFullName || repoFullName.trim().length === 0) return [];
    return logFingerprintRepository.findAllByRepository(repoFullName);
  }

  public getIncidentDetailMapByHash(hash: string, token: string): Record<string, any> | null {
    if (!hash) return null;
    const fp = logFingerprintRepository.findByHash(hash);
    if (!fp) return null;

    if (!this.validateIncidentAccess(fp.repositoryFullName, token)) {
      return { error: "forbidden" };
    }

    const safeToIso = (d: any): string => {
      if (!d) return new Date().toISOString();
      if (d instanceof Date) return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      if (typeof d === "string") {
        const parsed = new Date(d);
        return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
      }
      return new Date().toISOString();
    };

    return {
      hash: fp.hash,
      repositoryFullName: fp.repositoryFullName,
      normalizedSignature: fp.normalizedSignature,
      rawLog: fp.rawLog,
      state: fp.state,
      occurrenceCount: fp.occurrenceCount,
      prUrl: fp.prUrl || "",
      firstSeenAt: safeToIso(fp.firstSeenAt),
      lastSeenAt: safeToIso(fp.lastSeenAt),
    };
  }

  public validateIncidentAccess(repoFullName: string, token: string): boolean {
    if (!token || token.trim().length === 0) return false;

    // 1. Check custom repo-specific log receiver token
    const settings = repoSettingsRepository.findById(repoFullName);
    if (settings && settings.logReceiverToken && token === settings.logReceiverToken) {
      return true;
    }

    // 2. Allow valid GitHub Installation/PAT tokens from GitHub Actions runner
    if (
      token.startsWith("ghs_") ||
      token.startsWith("ghp_") ||
      token.startsWith("github_pat_")
    ) {
      return true;
    }

    return false;
  }

  public computeSha256(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

  private resolveTargetRepo(targetRepoHeader?: string | null): string | null {
    if (targetRepoHeader && targetRepoHeader.trim().length > 0) {
      return targetRepoHeader.trim();
    }
    return null;
  }
}

export const logIngestService = new LogIngestService();
