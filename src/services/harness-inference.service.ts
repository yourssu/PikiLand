export class HarnessInferenceService {
  public inferHarnessCmdFromFilenames(filenames: string[]): string | null {
    if (!filenames || filenames.length === 0) {
      return null;
    }

    const set = new Set(filenames);

    // 1. Gradle
    if (set.has("build.gradle.kts") || set.has("build.gradle")) {
      return set.has("gradlew") ? "./gradlew test" : "gradle test";
    }

    // 2. Maven
    if (set.has("pom.xml")) {
      return set.has("mvnw") ? "./mvnw test" : "mvn test";
    }

    // 3. Node.js / Bun / JavaScript
    if (set.has("package.json")) {
      if (set.has("bun.lockb") || set.has("bun.lock")) return "bun test";
      if (set.has("pnpm-lock.yaml")) return "pnpm test";
      if (set.has("yarn.lock")) return "yarn test";
      return "npm test";
    }

    // 4. Python
    if (set.has("requirements.txt") || set.has("pytest.ini") || set.has("pyproject.toml")) {
      return "pytest";
    }

    // 5. Go
    if (set.has("go.mod")) {
      return "go test ./...";
    }

    // 6. Rust
    if (set.has("Cargo.toml")) {
      return "cargo test";
    }

    // 7. Makefile
    if (set.has("Makefile") || set.has("makefile")) {
      return "make test";
    }

    // 8. Ruby
    if (set.has("Gemfile") || set.has(".rspec") || set.has("Rakefile")) {
      return "bundle exec rspec";
    }

    return null;
  }
}

export const harnessInferenceService = new HarnessInferenceService();
