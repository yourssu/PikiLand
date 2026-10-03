import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "crypto";
import { systemSettingsRepository } from "../db/repositories/system-settings.repository";
import { logFingerprintRepository } from "../db/repositories/log-fingerprint.repository";
import { isDebugMode } from "../config/debug";

export const webhookRoutes = new Hono();

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
    console.warn("[Webhook] Webhook secret is missing; refusing unsigned lifecycle updates.");
    return false;
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

function updateFingerprintState(hash: string | null, repoFullName: string, newState: "PR_CREATED" | "AWAITING_DEPLOYMENT" | "FAILED", prUrl?: string) {
  if (hash) {
    const fp = logFingerprintRepository.findByHash(hash);
    if (fp && fp.repositoryFullName === repoFullName) {
      fp.state = newState;
      if (prUrl) fp.prUrl = prUrl;
      fp.lastSeenAt = new Date();
      logFingerprintRepository.save(fp);
      return;
    }
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
    const repoFullName = payload.repository?.full_name || "";

    // GitHub events update existing production incidents only.
    if (event === "pull_request") {
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
          updateFingerprintState(hash, repoFullName, "AWAITING_DEPLOYMENT", prUrl);
        }
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
