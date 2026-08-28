import * as fs from "fs";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { systemSettingsRepository } from "../db/repositories/system-settings.repository";

export class GithubAuthService {
  private getAppConfig() {
    const globalSettings = systemSettingsRepository.getGlobalSettings();
    const appId = globalSettings?.githubAppId || process.env.GITHUB_APP_ID || "";
    let privateKey = globalSettings?.githubPrivateKeyContent || process.env.GITHUB_PRIVATE_KEY || "";

    if (!privateKey && process.env.GITHUB_PRIVATE_KEY_PATH) {
      try {
        if (fs.existsSync(process.env.GITHUB_PRIVATE_KEY_PATH)) {
          privateKey = fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH, "utf8");
        }
      } catch (e) {
        // ignore
      }
    }

    if (privateKey) {
      privateKey = privateKey.replace(/\\n/g, "\n");
    }

    return { appId, privateKey };
  }

  public getAppInstance(): App | null {
    const { appId, privateKey } = this.getAppConfig();
    if (!appId || !privateKey) return null;
    try {
      return new App({ appId, privateKey });
    } catch (e) {
      console.error("[GitHubAuth] Failed to initialize App instance:", e);
      return null;
    }
  }

  public async getInstallationToken(installationId: number): Promise<string | null> {
    const app = this.getAppInstance();
    if (!app) return null;
    try {
      const octokit = await app.getInstallationOctokit(installationId);
      const auth = (await octokit.auth({ type: "installation" })) as { token: string };
      return auth.token;
    } catch (e: any) {
      console.error(`[GitHubAuth] Failed to get installation token for id ${installationId}:`, e.message);
      return null;
    }
  }

  public async getInstallationTokenForRepo(repoFullName: string): Promise<string | null> {
    const app = this.getAppInstance();
    if (!app) return null;
    try {
      const [owner, repo] = repoFullName.split("/");
      const { data: installation } = await (app.octokit as any).request("GET /repos/{owner}/{repo}/installation", { owner, repo });
      const octokit = (await app.getInstallationOctokit(installation.id)) as any;
      const auth = (await octokit.auth({ type: "installation" })) as { token: string };
      return auth.token;
    } catch (e: any) {
      console.error(`[GitHubAuth] Failed to get token for ${repoFullName}:`, e.message);
      return null;
    }
  }

  public async isAppInstalledForRepo(repoFullName: string): Promise<boolean> {
    const token = await this.getInstallationTokenForRepo(repoFullName);
    return token !== null;
  }

  public async getDefaultBranchForRepo(repoFullName: string): Promise<string> {
    if (!repoFullName || !repoFullName.includes("/")) return "main";
    const app = this.getAppInstance();
    if (!app) return "main";
    try {
      const [owner, repo] = repoFullName.split("/");
      const { data: installation } = await (app.octokit as any).request("GET /repos/{owner}/{repo}/installation", { owner, repo });
      const octokit = (await app.getInstallationOctokit(installation.id)) as any;
      const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
      return repoData.default_branch || "main";
    } catch (e: any) {
      console.warn(`[GitHubAuth] Could not fetch default branch for ${repoFullName}, falling back to 'main':`, e.message);
      return "main";
    }
  }

  public async getUserInstalledRepositories(userAccessToken: string): Promise<string[]> {
    if (!userAccessToken) return [];
    const octokit = new Octokit({ auth: userAccessToken });
    const installedRepos: string[] = [];

    try {
      const { data } = await octokit.request("GET /user/installations");
      const installations = data.installations || [];

      for (const inst of installations) {
        try {
          const repoResp = await octokit.request("GET /user/installations/{installation_id}/repositories?per_page=100", {
            installation_id: inst.id,
          });
          const repos = repoResp.data.repositories || [];
          for (const r of repos) {
            if (r.full_name) {
              installedRepos.push(r.full_name);
            }
          }
        } catch (err: any) {
          console.error(`[GitHubAuth] Failed to fetch repos for installation ${inst.id}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[GitHubAuth] Failed to fetch user installations:", err.message);
    }

    return installedRepos;
  }

  public async fetchRepoFilenames(repoFullName: string, userAccessToken?: string | null): Promise<string[]> {
    if (!repoFullName || !repoFullName.includes("/")) return [];

    let effectiveToken = userAccessToken;
    if (!effectiveToken) {
      effectiveToken = await this.getInstallationTokenForRepo(repoFullName);
    }
    if (!effectiveToken) return [];

    try {
      const [owner, repo] = repoFullName.split("/");
      const octokit = new Octokit({ auth: effectiveToken });
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: "" });

      if (Array.isArray(data)) {
        return data.map((item) => item.name);
      }
    } catch (e: any) {
      console.error(`[GitHubAuth] Failed to fetch filenames for ${repoFullName}:`, e.message);
    }
    return [];
  }

  public async triggerWorkflowDispatch(params: {
    repoFullName: string;
    workflowId: string;
    ref: string;
    inputs: Record<string, string>;
    token?: string;
  }): Promise<void> {
    const [owner, repo] = params.repoFullName.split("/");
    let octokit: any;

    if (params.token) {
      octokit = new Octokit({ auth: params.token });
    } else {
      const app = this.getAppInstance();
      if (!app) throw new Error("GitHub App is not configured");
      const { data: installation } = await (app.octokit as any).request("GET /repos/{owner}/{repo}/installation", { owner, repo });
      octokit = (await app.getInstallationOctokit(installation.id)) as any;
    }

    let maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await octokit.rest.actions.createWorkflowDispatch({
          owner,
          repo,
          workflow_id: params.workflowId,
          ref: params.ref,
          inputs: params.inputs,
        });
        console.log(`[GitHubAuth] Successfully triggered '${params.workflowId}' on ref ${params.ref} for ${params.repoFullName}`);
        return;
      } catch (err: any) {
        if (err.status === 404 && attempt < maxRetries) {
          console.log(`[GitHubAuth] Workflow not yet indexed (404). Retrying in 2s (Attempt ${attempt}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          throw err;
        }
      }
    }
  }

  public async installWorkflowIfMissing(repoFullName: string, token: string, defaultBranch: string): Promise<void> {
    const [owner, repo] = repoFullName.split("/");
    const octokit = new Octokit({ auth: token });
    const path = ".github/workflows/pikiland.yml";
    const yamlContent = this.getWorkflowTemplateYaml();

    try {
      const { data } = (await octokit.rest.repos.getContent({ owner, repo, path, ref: defaultBranch })) as any;
      if (data && "sha" in data && typeof data.content === "string") {
        const existingContent = Buffer.from(data.content.replace(/\s+/g, ""), "base64").toString("utf-8");
        if (existingContent.trim() === yamlContent.trim()) {
          console.log(`[GitHub] pikiland.yml already up-to-date in ${repoFullName}`);
          return;
        }
        console.log(`[GitHub] Updating pikiland.yml in ${repoFullName}...`);
        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: "ci: update PikiLand self-healing workflow",
          content: Buffer.from(yamlContent).toString("base64"),
          sha: data.sha,
          branch: defaultBranch,
        });
      }
    } catch (err: any) {
      if (err.status === 404) {
        console.log(`[GitHub] Installing pikiland.yml in ${repoFullName}...`);
        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: "ci: install PikiLand self-healing workflow",
          content: Buffer.from(yamlContent).toString("base64"),
          branch: defaultBranch,
        });
      } else {
        console.error(`[GitHub] Failed to check/install workflow in ${repoFullName}:`, err.message);
      }
    }
  }

  public async fetchIssueBody(repoFullName: string, issueNumber: number, token?: string): Promise<string> {
    const [owner, repo] = repoFullName.split("/");
    const octokit = new Octokit(token ? { auth: token } : {});
    try {
      const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
      return `Issue #${issueNumber} Title: ${data.title || ""}\n\n${data.body || ""}`;
    } catch (e: any) {
      console.error(`[GitHubAuth] Failed to fetch issue #${issueNumber}:`, e.message);
      return "";
    }
  }

  public getWorkflowTemplateYaml(): string {
    return `name: PikiLand Self-Healing

on:
  workflow_dispatch:
    inputs:
      event_type:
        description: 'Original event type'
        required: true
      log_content:
        description: 'Truncated error log or issue body (Optional - CLI downloads via run_id if omitted)'
        required: false
      run_id:
        description: 'Original run ID or issue number'
        required: true
      target_branch:
        description: 'Branch to checkout and patch'
        required: true
      slack_webhook_url:
        description: 'Slack Webhook URL'
        required: false
      ai_model:
        description: 'AI model name'
        required: false
      ai_base_url:
        description: 'Custom AI API Base URL'
        required: false
      harness_cmd:
        description: 'Command to run harness verification (e.g. ./gradlew test, cargo test, pytest)'
        required: false
      ralph_max_retries:
        description: 'Ralph Loop max retries cap'
        required: false
      pikiland_server_url:
        description: 'PikiLand Web Server URL (HTTPS Port 443)'
        required: false

jobs:
  pikiland-patch:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      actions: read
    steps:
      - name: Checkout Target Repository
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.inputs.target_branch }}
          fetch-depth: 0

      - name: Checkout PikiLand Engine
        uses: actions/checkout@v4
        with:
          repository: 'yourssu/PikiLand-Engine'
          ref: 'main'
          path: 'pikiland-engine'
          token: \${{ secrets.PIKILAND_GITHUB_TOKEN || secrets.GITHUB_TOKEN }}

      - name: Setup Bun Environment
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Run PikiLand CLI (TypeScript + Bun Engine)
        env:
          PIKILAND_CLI: "true"
          PIKILAND_EVENT_TYPE: "\${{ github.event.inputs.event_type }}"
          PIKILAND_LOG_CONTENT: "\${{ github.event.inputs.log_content }}"
          PIKILAND_RUN_ID: "\${{ github.event.inputs.run_id }}"
          PIKILAND_FINGERPRINT_HASH: "\${{ github.event.inputs.run_id }}"
          PIKILAND_TARGET_BRANCH: "\${{ github.event.inputs.target_branch }}"
          PIKILAND_WORKSPACE_PATH: "\${{ github.workspace }}"
          PIKILAND_HARNESS_CMD: "\${{ github.event.inputs.harness_cmd }}"
          PIKILAND_RALPH_MAX_RETRIES: "\${{ github.event.inputs.ralph_max_retries }}"
          PIKILAND_SERVER_URL: "\${{ github.event.inputs.pikiland_server_url }}"
          GITHUB_TOKEN: "\${{ secrets.GITHUB_TOKEN }}"
          GITHUB_REPOSITORY: "\${{ github.repository }}"
          SLACK_WEBHOOK_URL: "\${{ github.event.inputs.slack_webhook_url }}"
          AI_MODEL: "\${{ github.event.inputs.ai_model }}"
          PIKILAND_AI_BASE_URL: "\${{ github.event.inputs.ai_base_url }}"
          OPENAI_BASE_URL: "\${{ github.event.inputs.ai_base_url }}"
          ANTHROPIC_BASE_URL: "\${{ github.event.inputs.ai_base_url }}"
          OPENAI_API_KEY: "\${{ secrets.OPENAI_API_KEY || secrets.PIKILAND_AI_API_KEY }}"
          ANTHROPIC_API_KEY: "\${{ secrets.ANTHROPIC_API_KEY || secrets.PIKILAND_AI_API_KEY }}"
        run: |
          cd pikiland-engine
          bun install
          bun run ./src/index.ts
`;
  }
}

export const githubAuthService = new GithubAuthService();
