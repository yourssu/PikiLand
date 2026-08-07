package com.yourssu.pikiland.application.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

@Service
public class HarnessInferenceService {

    private static final Logger logger = LoggerFactory.getLogger(HarnessInferenceService.class);

    public HarnessInferenceService() {
    }

    public String inferHarnessCmdFromFilenames(List<String> filenames) {
        if (filenames == null || filenames.isEmpty()) {
            return null;
        }

        // 1. Gradle
        if (filenames.contains("build.gradle.kts") || filenames.contains("build.gradle")) {
            return filenames.contains("gradlew") ? "./gradlew test" : "gradle test";
        }

        // 2. Maven
        if (filenames.contains("pom.xml")) {
            return filenames.contains("mvnw") ? "./mvnw test" : "mvn test";
        }

        // 3. Node.js / Bun / JavaScript
        if (filenames.contains("package.json")) {
            return (filenames.contains("bun.lockb") || filenames.contains("bun.lock")) ? "bun test" : "npm test";
        }

        // 4. Python
        if (filenames.contains("requirements.txt") ||
            filenames.contains("pytest.ini") ||
            filenames.contains("pyproject.toml")) {
            return "pytest";
        }

        // 5. Go
        if (filenames.contains("go.mod")) {
            return "go test ./...";
        }

        // 6. Rust
        if (filenames.contains("Cargo.toml")) {
            return "cargo test";
        }

        // 7. Makefile
        if (filenames.contains("Makefile") || filenames.contains("makefile")) {
            return "make test";
        }

        return null;
    }

    public String inferHarnessCmdFromWorkspace(Path workspace) {
        if (workspace == null || !Files.exists(workspace)) {
            return null;
        }

        // 1. Gradle
        if (Files.exists(workspace.resolve("build.gradle.kts")) || Files.exists(workspace.resolve("build.gradle"))) {
            return Files.exists(workspace.resolve("gradlew")) ? "./gradlew test" : "gradle test";
        }

        // 2. Maven
        if (Files.exists(workspace.resolve("pom.xml"))) {
            return Files.exists(workspace.resolve("mvnw")) ? "./mvnw test" : "mvn test";
        }

        // 3. Node.js / Bun / JavaScript
        if (Files.exists(workspace.resolve("package.json"))) {
            return (Files.exists(workspace.resolve("bun.lockb")) || Files.exists(workspace.resolve("bun.lock"))) ? "bun test" : "npm test";
        }

        // 4. Python
        if (Files.exists(workspace.resolve("requirements.txt")) ||
            Files.exists(workspace.resolve("pytest.ini")) ||
            Files.exists(workspace.resolve("pyproject.toml"))) {
            return "pytest";
        }

        // 5. Go
        if (Files.exists(workspace.resolve("go.mod"))) {
            return "go test ./...";
        }

        // 6. Rust
        if (Files.exists(workspace.resolve("Cargo.toml"))) {
            return "cargo test";
        }

        // 7. Makefile
        if (Files.exists(workspace.resolve("Makefile")) || Files.exists(workspace.resolve("makefile"))) {
            return "make test";
        }

        return null;
    }
}
