import { Hono } from "hono";
import { randomUUID } from "crypto";
import { dashboardService } from "../services/dashboard.service";
import { ec2ProvisionService } from "../services/ec2-provision.service";
import { logIngestService } from "../services/log-ingest.service";
import { logPathInferenceService } from "../services/log-path-inference.service";
import { githubAuthService } from "../services/github-auth.service";
import { repoSettingsRepository } from "../db/repositories/repo-settings.repository";
import { getSessionUser } from "./auth.routes";
import { RepoSettingsDto, SystemSettingsDto } from "../domain/models";

export const settingsRoutes = new Hono();

export async function isAuthorizedForRepo(
  fullName: string,
  user: { username: string; accessToken?: string; isAdmin: boolean } | null
): Promise<boolean> {
  const isDebug = process.env.DEBUG === "true" || process.env.PIKILAND_DEBUG === "true";
  if (isDebug) return true;
  if (!user) return false;
  if (user.isAdmin) return true;

  const [owner] = fullName.split("/");
  if (owner && owner.toLowerCase() === user.username.toLowerCase()) {
    return true;
  }

  if (user.accessToken) {
    const installedRepos = await githubAuthService.getUserInstalledRepositories(user.accessToken);
    if (installedRepos.includes(fullName)) {
      return true;
    }
  }

  return false;
}

// Global System Settings (Admin Only)
settingsRoutes.get("/system", (c) => {
  const user = getSessionUser(c);
  if (!user?.isAdmin) {
    return c.text("Forbidden", 403);
  }
  return c.json(dashboardService.getSystemSettings());
});

settingsRoutes.post("/system", async (c) => {
  const user = getSessionUser(c);
  if (!user?.isAdmin) {
    return c.text("Forbidden", 403);
  }
  const body = (await c.req.json()) as SystemSettingsDto;
  dashboardService.updateSystemSettings(body);
  return c.json({ status: "success" });
});

// Repository Settings
settingsRoutes.post("/", async (c) => {
  const user = getSessionUser(c);
  const dto = (await c.req.json()) as RepoSettingsDto;

  if (!(await isAuthorizedForRepo(dto.fullName, user))) {
    console.error(`[Settings] FORBIDDEN — user '${user?.username}' tried to update '${dto.fullName}'`);
    return c.text("Forbidden", 403);
  }

  const updated = await dashboardService.updateRepoSettings(dto, user?.accessToken);
  return c.json(updated);
});

// Approve Inferred Harness Command
settingsRoutes.post("/harness/approve", async (c) => {
  const user = getSessionUser(c);
  const body = (await c.req.json()) as { fullName: string };

  if (!(await isAuthorizedForRepo(body.fullName, user))) {
    return c.text("Forbidden", 403);
  }

  const updated = await dashboardService.approveInferredHarness(body.fullName);
  return c.json(updated);
});

// Infer Harness Command
settingsRoutes.post("/harness/infer", async (c) => {
  const user = getSessionUser(c);
  const body = (await c.req.json()) as { fullName: string };

  if (!(await isAuthorizedForRepo(body.fullName, user))) {
    return c.text("Forbidden", 403);
  }

  const updated = await dashboardService.reInferHarness(body.fullName, user?.accessToken);
  return c.json(updated);
});

// Infer Log Path
settingsRoutes.get("/infer-log-path", async (c) => {
  const repo = c.req.query("repo");
  const user = getSessionUser(c);
  if (!repo) {
    return c.json({ inferredLogPath: "/var/log/production/*.log" });
  }
  const filenames = await githubAuthService.fetchRepoFilenames(repo, user?.accessToken);
  const inferredLogPath = logPathInferenceService.inferLogPathFromFilenames(filenames);
  return c.json({ inferredLogPath });
});

// Provision EC2 Fluent Bit (1-Time SSH)
settingsRoutes.post("/provision-ec2", async (c) => {
  try {
    const formData = await c.req.formData();
    const repositoryFullName = String(formData.get("repositoryFullName") || "");
    const ec2Ip = String(formData.get("ec2Ip") || "");
    const sshUser = String(formData.get("sshUser") || "");
    const logPath = String(formData.get("logPath") || "/var/log/production/*.log");
    const pemKeyFile = formData.get("pemKey");

    if (!repositoryFullName || !ec2Ip || !sshUser || !pemKeyFile) {
      return c.json({ status: "error", message: "Required parameters missing" }, 400);
    }

    let pemKeyContent = "";
    if (typeof pemKeyFile === "string") {
      pemKeyContent = pemKeyFile;
    } else if (pemKeyFile instanceof Blob) {
      pemKeyContent = await pemKeyFile.text();
    }

    const hostHeader = c.req.header("X-Forwarded-Host") || c.req.header("Host") || "localhost";
    const pipelineServerHost = hostHeader.includes(":") ? hostHeader.split(":")[0] : hostHeader;
    const isHttps = c.req.header("X-Forwarded-Proto") === "https" || c.req.url.startsWith("https://");
    const pipelineServerPort = isHttps ? 443 : 8080;
    const existingSettings = repoSettingsRepository.findById(repositoryFullName);
    const bearerToken = existingSettings?.logReceiverToken || randomUUID();

    const success = await ec2ProvisionService.provisionInstance({
      repositoryFullName,
      ec2Ip,
      sshUser,
      logPath,
      pemKeyContent,
      pipelineServerHost,
      pipelineServerPort,
      bearerToken,
    });

    if (success) {
      return c.json({
        status: "success",
        message: "EC2 Fluent Bit provisioned and SSH key revoked successfully",
      });
    } else {
      return c.json({ status: "error", message: "Provisioning failed. Check server logs." }, 500);
    }
  } catch (e: any) {
    return c.json({ status: "error", message: e.message }, 500);
  }
});

// Incidents List
settingsRoutes.get("/incidents", (c) => {
  const repo = c.req.query("repo");
  if (!repo) return c.json([]);
  return c.json(logIngestService.getIncidentsForRepository(repo));
});

// Incident Detail
settingsRoutes.get("/incidents/detail", (c) => {
  const hash = c.req.query("hash");
  const authHeader = c.req.header("Authorization");

  if (!hash) {
    return c.json({ status: "error", message: "Hash parameter missing" }, 400);
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ status: "error", message: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.substring(7).trim();
  const detail = logIngestService.getIncidentDetailMapByHash(hash, token);
  if (!detail) {
    return c.text("Not Found", 404);
  }
  if (detail.error === "forbidden") {
    return c.json({ status: "error", message: "Access denied for incident details" }, 403);
  }

  return c.json(detail);
});
