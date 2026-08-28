import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "crypto";
import { systemSettingsRepository } from "../db/repositories/system-settings.repository";
import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";
import { logFingerprintRepository } from "../db/repositories/log-fingerprint.repository";
import { selfHealingService } from "../services/self-healing.service";

export const webhookRoutes = new Hono();

function isDebugMode(): boolean {
  return process.env.DEBUG === "true" || process.env.PIKILAND_DEBUG === "true";
}

function getEffectiveWebhookSecret(): string {
  const globalSettings = systemSettingsRepository.getGlobalSettings();
  if (globalSettings?.githubWebhookSecret && globalSettings.githubWebhookSecret.trim().length > 0) {
    return globalSettings.githubWebhookSecret.trim();
  }
  return process.env.GITHUB_WEBHOOK_SECRET || process.env.PIKILAND_GITHUB_WEBHOOK_SECRET || "";
}

function verifySignature(payloadBuffer: Buffer, signatureHeader?: string | null): boolean {
  if (isDebugMode()) {
    console.log("[Webhook] Signature verification SKIPPED (debug mode)");
    return true;
  }

  const secret = getEffectiveWebhookSecret();
  if (!secret) {
    console.log("[Webhook Warning] Webhook Secret is empty. Accepting payload in permissive mode.");
    return true;
  }

  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    console.error("[Webhook] REJECTED — Missing or malformed X-Hub-Signature-256 header.");
    return false;
  }

  try {
    const expected = "sha256=" + createHmac("sha256", secret).update(payloadBuffer).digest("hex");
    const sigBuf = Buffer.from(signatureHeader, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch (e: any) {
    console.error("[Webhook] Signature computation error:", e.message);
    return false;
  }
}

function isPikilandSelfWorkflow(workflowPath?: string, workflowName?: string): boolean {
  if (workflowPath && (workflowPath.endsWith("pikiland.yml") || workflowPath.endsWith("pikiland.yaml"))) {
    return true;
  }
  return Boolean(workflowName && workflowName.toLowerCase().includes("pikiland"));
}

function isPikilandSelfIssue(issueNode: any, issueBody?: string, senderLogin?: string): boolean {
  if (
    issueBody &&
    (issueBody.includes("PikiLand AI Self-Healing Engine") ||
      issueBody.includes("Authored by PikiLand") ||
      issueBody.includes("Authored by PikiLand Engine") ||
      issueBody.includes("PikiLand Incident Fingerprint:") ||
      issueBody.includes("Created automatically by PikiLand"))
  ) {
    return true;
  }
  if (senderLogin && senderLogin.toLowerCase().includes("pikiland")) {
    return true;
  }
  const issueTitle = String(issueNode?.title || "");
  if (issueTitle.startsWith("[PikiLand]") || issueTitle.includes("PikiLand Incident")) {
    return true;
  }
  const labels = issueNode?.labels || [];
  if (Array.isArray(labels)) {
    for (const label of labels) {
      const name = typeof label === "string" ? label.toLowerCase() : String(label?.name || "").toLowerCase();
      if (name === "pikiland-incident" || name.includes("pikiland")) {
        return true;
      }
    }
  }
  return false;
}

function extractFingerprintHash(headRef?: string, prBody?: string): string | null {
  if (headRef && headRef.startsWith("pikiland/fix-")) {
    return headRef.substring("pikiland/fix-".length).trim();
  }
  if (prBody && prBody.includes("PikiLand Incident Fingerprint:")) {
    const idx = prBody.indexOf("PikiLand Incident Fingerprint:");
    const sub = prBody.substring(idx + "PikiLand Incident Fingerprint:".length).trim();
    const end = sub.indexOf("\n");
    return (end !== -1 ? sub.substring(0, end) : sub).trim();
  }
  return null;
}

function updateFingerprintState(hash: string | null, repoFullName: string, newState: "PR_CREATED" | "RESOLVED" | "FAILED", prUrl?: string) {
  if (hash) {
    const fp = logFingerprintRepository.findByHash(hash);
    if (fp) {
      fp.state = newState;
      if (prUrl) fp.prUrl = prUrl;
      fp.lastSeenAt = new Date();
      logFingerprintRepository.save(fp);
      return;
    }
  }

  // Fallback: If hash is null, update only the most recent active incident for this repo
  const list = logFingerprintRepository.findAllByRepository(repoFullName);
  const activeList = list
    .filter((fp) => fp.state === "IN_PROGRESS" || fp.state === "PR_CREATED")
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  if (activeList.length > 0) {
    const latest = activeList[0];
    latest.state = newState;
    if (prUrl) latest.prUrl = prUrl;
    latest.lastSeenAt = new Date();
    logFingerprintRepository.save(latest);
  }
}

async function handleWebhookPost(c: any) {
  let rawBuffer: Buffer;
  let rawBody: string;

  try {
    const arrayBuf = await c.req.raw.arrayBuffer();
    rawBuffer = Buffer.from(arrayBuf);
    rawBody = new TextDecoder().decode(rawBuffer);
  } catch (e: any) {
    console.error("[Webhook Controller] Failed to read request body:", e.message);
    return c.text("Bad Request", 400);
  }

  const event = c.req.header("X-GitHub-Event") || "unknown";
  const signature = c.req.header("X-Hub-Signature-256");

  console.log(`[Webhook Controller] Incoming HTTP POST. Event: '${event}', Signature Present: ${Boolean(signature)}`);

  if (!verifySignature(rawBuffer, signature)) {
    console.error(`[Webhook Controller] REJECTED — signature verification failed for event: ${event}`);
    return c.text("Invalid signature", 401);
  }

  try {
    const payload = JSON.parse(rawBody);
    const installationId = payload.installation?.id || 0;
    const repoFullName = payload.repository?.full_name || "";
    const defaultBranch = payload.repository?.default_branch || "main";

    console.log(`[Webhook Received] Event: '${event}' for repository: ${repoFullName}`);

    const settings = repoFullName ? repoSettingsRepository.findById(repoFullName) : null;

    if (event === "workflow_run") {
      const action = payload.action;
      const run = payload.workflow_run || {};
      const conclusion = run.conclusion;
      const runId = String(run.id || "");
      const headBranch = run.head_branch || defaultBranch;
      const workflowPath = run.path || "";
      const workflowName = run.name || "";

      console.log(`[Webhook Workflow] Run ID: ${runId}, Action: ${action}, Conclusion: ${conclusion}, Name: ${workflowName}`);

      if (isPikilandSelfWorkflow(workflowPath, workflowName)) {
        console.log(`[Webhook] PikiLand self-healing workflow completion detected. Run ID: ${runId}, Conclusion: ${conclusion}`);
        if (action === "completed" && conclusion === "failure") {
          const extractedHash = headBranch.startsWith("pikiland/fix-")
            ? headBranch.substring("pikiland/fix-".length).trim()
            : null;
          updateFingerprintState(extractedHash, repoFullName, "FAILED");
        }
        return c.text("Accepted", 200);
      }

      if (action === "completed" && conclusion === "failure") {
        if (settings && !settings.active) {
          console.log(`[Webhook Notice] Repo ${repoFullName} is INACTIVE. Skipping self-healing.`);
          return c.text("Accepted", 200);
        }
        console.log(`[Webhook Action] 🚀 Target Workflow Failure Detected! Run ID: ${runId}, Repo: ${repoFullName}, Head Branch: ${headBranch}`);

        const existingFp = logFingerprintRepository.findByHash(runId);
        if (!existingFp) {
          logFingerprintRepository.save({
            hash: runId,
            repositoryFullName: repoFullName,
            normalizedSignature: `Workflow Failure: ${workflowName || "CI"} (Run #${runId})`,
            rawLog: `Workflow Run ID: ${runId}\nBranch: ${headBranch}\nWorkflow: ${workflowPath || workflowName}`,
            state: "IN_PROGRESS",
            occurrenceCount: 1,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          });
        }

        selfHealingService.runSelfHealing({
          repoName: repoFullName,
          rawLogOrIssueBody: null,
          eventType: "workflow_run",
          runId,
          installationId,
          targetBranch: headBranch,
          defaultBranch,
        });
      }
    } else if (event === "pull_request") {
      const action = payload.action;
      const pr = payload.pull_request || {};
      const headRef = pr.head?.ref || "";
      const prBody = pr.body || "";
      const prUrl = pr.html_url || "";
      const merged = Boolean(pr.merged);

      if (headRef.startsWith("pikiland/") || prBody.includes("PikiLand Incident Fingerprint:")) {
        const hash = extractFingerprintHash(headRef, prBody);
        console.log(`[Webhook PR] PikiLand Patch PR Event: action=${action}, hash=${hash}, url=${prUrl}`);

        if (action === "opened") {
          updateFingerprintState(hash, repoFullName, "PR_CREATED", prUrl);
        } else if (action === "closed" && merged) {
          updateFingerprintState(hash, repoFullName, "RESOLVED", prUrl);
        }
      }
    } else if (event === "issues") {
      const action = payload.action;
      if (action === "opened") {
        const issue = payload.issue || {};
        const issueBody = issue.body || "";
        const issueNumber = String(issue.number || "");
        const senderLogin = payload.sender?.login || "";

        if (isPikilandSelfIssue(issue, issueBody, senderLogin)) {
          console.log(`[Webhook Notice] Issue #${issueNumber} created by PikiLand. Skipping to prevent loop.`);
          return c.text("Accepted", 200);
        }

        if (settings && !settings.active) {
          console.log(`[Webhook Notice] Repo ${repoFullName} is INACTIVE. Skipping issue self-healing.`);
          return c.text("Accepted", 200);
        }

        console.log(`[Webhook Action] 🚀 Issue Opened Detected! Issue #: ${issueNumber}, Repo: ${repoFullName}`);
        selfHealingService.runSelfHealing({
          repoName: repoFullName,
          rawLogOrIssueBody: issueBody,
          eventType: "issues",
          runId: issueNumber,
          installationId,
          targetBranch: defaultBranch,
          defaultBranch,
        });
      }
    }

    return c.text("Accepted", 200);
  } catch (e: any) {
    console.error("[Webhook] Failed to parse payload:", e.message);
    return c.text("Accepted", 200);
  }
}

webhookRoutes.post("/webhook", handleWebhookPost);
webhookRoutes.post("/webhook/", handleWebhookPost);
webhookRoutes.post("/api/webhook", handleWebhookPost);
webhookRoutes.post("/api/webhook/", handleWebhookPost);
