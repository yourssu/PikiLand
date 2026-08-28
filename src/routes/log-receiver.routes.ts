import { Hono } from "hono";
import { logIngestService } from "../services/log-ingest.service";
import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";

export const logReceiverRoutes = new Hono();

logReceiverRoutes.post("/ingest", async (c) => {
  const authHeader = c.req.header("Authorization");
  const repoHeader = c.req.header("X-Pikiland-Repo");

  // 1. Validate X-Pikiland-Repo header
  if (!repoHeader || repoHeader.trim().length === 0) {
    console.warn("[LogReceiver] Missing required X-Pikiland-Repo header.");
    return c.json({ status: "error", message: "Missing required X-Pikiland-Repo header" }, 400);
  }

  const repoFullName = repoHeader.trim();

  // 2. Bearer Token Verification
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("[LogReceiver] Missing or invalid Authorization header format.");
    return c.json({ status: "error", message: "Unauthorized token" }, 401);
  }

  const token = authHeader.substring(7).trim();
  const settings = repoSettingsRepository.findById(repoFullName);
  if (!settings || !settings.logReceiverToken || token !== settings.logReceiverToken) {
    console.warn(`[LogReceiver] Token mismatch or log ingest not configured for repo '${repoFullName}'.`);
    return c.json({ status: "error", message: "Unauthorized repository token" }, 401);
  }

  let rawText = "";
  try {
    rawText = await c.req.text();
  } catch (e: any) {
    console.error("[LogReceiver] Failed to read request body:", e.message);
    return c.json({ status: "error", message: "Failed to read request body" }, 400);
  }

  if (!rawText || rawText.trim().length === 0) {
    return c.json({ status: "success", processed_records: 0 });
  }

  let rawPayload: any = rawText;
  const trimmed = rawText.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      rawPayload = JSON.parse(trimmed);
    } catch {
      rawPayload = trimmed;
    }
  }

  const payloads: Array<Record<string, any>> = [];

  try {
    if (Array.isArray(rawPayload)) {
      for (const item of rawPayload) {
        if (typeof item === "object" && item !== null) {
          payloads.push(item);
        }
      }
    } else if (typeof rawPayload === "object" && rawPayload !== null) {
      payloads.push(rawPayload);
    } else if (typeof rawPayload === "string") {
      const trimmed = rawPayload.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            payloads.push(...parsed);
          } else if (typeof parsed === "object" && parsed !== null) {
            payloads.push(parsed);
          }
        } catch (e) {
          payloads.push({ log: trimmed });
        }
      } else {
        payloads.push({ log: trimmed });
      }
    }

    const processedRecords = await logIngestService.processIngestedLogs(repoHeader, payloads);
    return c.json({ status: "success", processed_records: processedRecords });
  } catch (e: any) {
    console.error("[LogReceiver] Error processing log payload:", e);
    return c.json({ status: "error", message: "Invalid log payload" }, 400);
  }
});
