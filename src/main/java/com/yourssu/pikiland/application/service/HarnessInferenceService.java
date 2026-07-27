package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.model.HarnessSource;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

@Service
public class HarnessInferenceService {

    private final RepoSettingsRepository repoSettingsRepository;

    public HarnessInferenceService(RepoSettingsRepository repoSettingsRepository) {
        this.repoSettingsRepository = repoSettingsRepository;
    }

    public String inferHarnessCmdFromWorkspace(Path workspace) {
        if (workspace == null || !Files.exists(workspace)) {
            return null;
        }

        // 1. Gradle
        if (Files.exists(workspace.resolve("build.gradle.kts")) || Files.exists(workspace.resolve("build.gradle"))) {
            return "./gradlew test";
        }

        // 2. Maven
        if (Files.exists(workspace.resolve("pom.xml"))) {
            return Files.exists(workspace.resolve("mvnw")) ? "./mvnw test" : "mvn test";
        }

        // 3. Node.js / JavaScript
        if (Files.exists(workspace.resolve("package.json"))) {
            return "npm test";
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
        if (Files.exists(workspace.resolve("Makefile"))) {
            return "make test";
        }

        return null;
    }
}
