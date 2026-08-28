import { describe, expect, it, beforeEach } from "bun:test";
import { githubAuthService } from "../src/services/github-auth.service";
import { selfHealingService } from "../src/services/self-healing.service";
import { systemSettingsRepository } from "../src/db/repositories/system-settings.repository";
import { repoSettingsRepository } from "../src/db/repositories/repo-settings.repository";

describe("Self-Healing Workflow Template & Dispatch Contract", () => {
  beforeEach(() => {
    systemSettingsRepository.saveGlobalSettings({
      githubAppId: "9988",
      githubPrivateKeyContent: "mock-key",
      pikilandServerUrl: "http://pikiland.yourssu.com",
    });
  });

  it("should provide valid pikiland.yml template conforming to Execution Engine Contract", () => {
    const yaml = githubAuthService.getWorkflowTemplateYaml();

    // Check action name and trigger
    expect(yaml).toContain("name: PikiLand Self-Healing");
    expect(yaml).toContain("workflow_dispatch:");

    // Check essential inputs
    expect(yaml).toContain("event_type:");
    expect(yaml).toContain("log_content:");
    expect(yaml).toContain("run_id:");
    expect(yaml).toContain("target_branch:");
    expect(yaml).toContain("harness_cmd:");
    expect(yaml).toContain("ralph_max_retries:");
    expect(yaml).toContain("pikiland_server_url:");

    // Check runner setup
    expect(yaml).toContain("runs-on: ubuntu-latest");
    expect(yaml).toContain("yourssu/PikiLand-Engine");
    expect(yaml).toContain("oven-sh/setup-bun@v2");
    expect(yaml).toContain("bun run ./src/index.ts");
  });

  it("should respect server URL normalization (HTTP -> HTTPS for public domains, keeping localhost)", () => {
    const formatUrl = (selfHealingService as any).formatServerUrl.bind(selfHealingService);
    
    expect(formatUrl("pikiland.yourssu.com")).toBe("https://pikiland.yourssu.com");
    expect(formatUrl("http://pikiland.yourssu.com")).toBe("https://pikiland.yourssu.com");
    expect(formatUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(formatUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });
});
