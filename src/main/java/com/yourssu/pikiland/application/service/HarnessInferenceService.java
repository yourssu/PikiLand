package com.yourssu.pikiland.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.yourssu.pikiland.domain.model.HarnessSource;
import com.yourssu.pikiland.domain.port.LlmPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

@Service
public class HarnessInferenceService {

    private static final Logger logger = LoggerFactory.getLogger(HarnessInferenceService.class);

    private final LlmPort llmPort;

    public HarnessInferenceService() {
        this(null);
    }

    @Autowired
    public HarnessInferenceService(@Autowired(required = false) LlmPort llmPort) {
        this.llmPort = llmPort;
    }

    public String inferHarnessCmdFromFilenames(List<String> filenames) {
        if (filenames == null || filenames.isEmpty()) {
            return null;
        }

        // 1. Gradle
        if (filenames.contains("build.gradle.kts") || filenames.contains("build.gradle")) {
            return "./gradlew test";
        }

        // 2. Maven
        if (filenames.contains("pom.xml")) {
            return filenames.contains("mvnw") ? "./mvnw test" : "mvn test";
        }

        // 3. Node.js / JavaScript
        if (filenames.contains("package.json")) {
            return "npm test";
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

        // 8. LLM Strict Structured Output Fallback
        if (llmPort != null) {
            try {
                String systemPrompt = "You are a DevOps CI/CD test harness expert. Infer the exact test execution command for the given workspace filenames.\n" +
                                      "Output MUST strictly adhere to the requested JSON Schema.";

                String userPrompt = "Workspace filenames: " + filenames;

                Map<String, Object> jsonSchema = Map.of(
                    "name", "harness_cmd_response",
                    "strict", true,
                    "schema", Map.of(
                        "type", "object",
                        "properties", Map.of(
                            "harnessCmd", Map.of(
                                "type", "string",
                                "description", "The exact test execution command (e.g., ./gradlew test)"
                            )
                        ),
                        "required", List.of("harnessCmd"),
                        "additionalProperties", false
                    )
                );

                JsonNode result = llmPort.callLlmWithStrictSchema(systemPrompt, userPrompt, jsonSchema);
                if (result != null && result.has("harnessCmd")) {
                    String cmd = result.get("harnessCmd").asText().trim();
                    if (!cmd.isBlank()) {
                        logger.info("[HarnessInference] LLM Strict Structured Output inferred harness command: {}", cmd);
                        return cmd;
                    }
                }
            } catch (Exception e) {
                logger.warn("[HarnessInference] LLM inference failed: {}", e.getMessage());
            }
        }

        return null;
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
        if (Files.exists(workspace.resolve("Makefile")) || Files.exists(workspace.resolve("makefile"))) {
            return "make test";
        }

        return null;
    }
}
