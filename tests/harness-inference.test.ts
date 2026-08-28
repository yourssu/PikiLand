import { describe, expect, it } from "bun:test";
import { harnessInferenceService } from "../src/services/harness-inference.service";

describe("HarnessInferenceService", () => {
  it("should infer gradle wrapper test command for build.gradle.kts with gradlew", () => {
    const filenames = ["build.gradle.kts", "gradlew", "settings.gradle.kts", "src"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("./gradlew test");
  });

  it("should infer gradle test command for build.gradle without gradlew", () => {
    const filenames = ["build.gradle", "settings.gradle", "src"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("gradle test");
  });

  it("should infer bun test for package.json with bun.lock", () => {
    const filenames = ["package.json", "bun.lock", "src"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("bun test");
  });

  it("should infer npm test for package.json with package-lock.json", () => {
    const filenames = ["package.json", "package-lock.json", "src"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("npm test");
  });

  it("should infer yarn test for package.json with yarn.lock", () => {
    const filenames = ["package.json", "yarn.lock", "src"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("yarn test");
  });

  it("should infer pnpm test for package.json with pnpm-lock.yaml", () => {
    const filenames = ["package.json", "pnpm-lock.yaml", "src"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("pnpm test");
  });

  it("should infer go test for Go repositories", () => {
    const filenames = ["go.mod", "main.go"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("go test ./...");
  });

  it("should infer make test for Makefile repositories", () => {
    const filenames = ["Makefile", "main.c"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("make test");
  });

  it("should infer pytest for Python repositories", () => {
    const filenames = ["requirements.txt", "main.py"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("pytest");
  });

  it("should infer cargo test for Rust repositories", () => {
    const filenames = ["Cargo.toml", "src/main.rs"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("cargo test");
  });

  it("should infer bundle exec rspec for Ruby repositories", () => {
    const filenames = ["Gemfile", "app/models/user.rb"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBe("bundle exec rspec");
  });

  it("should return null for unknown file structure", () => {
    const filenames = ["README.md", "notes.txt"];
    const cmd = harnessInferenceService.inferHarnessCmdFromFilenames(filenames);
    expect(cmd).toBeNull();
  });
});
