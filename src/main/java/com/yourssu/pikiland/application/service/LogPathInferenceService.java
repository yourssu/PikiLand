package com.yourssu.pikiland.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.yourssu.pikiland.domain.port.LlmPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class LogPathInferenceService {

    private static final Logger logger = LoggerFactory.getLogger(LogPathInferenceService.class);

    private final LlmPort llmPort;

    public LogPathInferenceService() {
        this(null);
    }

    @Autowired
    public LogPathInferenceService(@Autowired(required = false) LlmPort llmPort) {
        this.llmPort = llmPort;
    }

    public String inferLogPath(List<String> filenames, String repoConfigFileContent) {
        if (llmPort != null && ((filenames != null && !filenames.isEmpty()) || (repoConfigFileContent != null && !repoConfigFileContent.isBlank()))) {
            try {
                String systemPrompt = "You are a strict DevOps log collector expert. Infer the exact production log file path for Fluent Bit tail input.\n" +
                                      "Evaluate the provided repository structure and configuration.\n" +
                                      "Output MUST strictly adhere to the requested JSON Schema.";

                String userPrompt = "Top-level repo filenames: " + (filenames != null ? filenames : "[]") +
                                    "\n[CONFIG_FILE_CONTENT]\n" + (repoConfigFileContent != null ? repoConfigFileContent : "None");

                Map<String, Object> jsonSchema = Map.of(
                    "name", "log_path_response",
                    "strict", true,
                    "schema", Map.of(
                        "type", "object",
                        "properties", Map.of(
                            "logPath", Map.of(
                                "type", "string",
                                "description", "The exact production log file path or glob pattern (e.g., /var/log/spring/*.log)"
                            )
                        ),
                        "required", List.of("logPath"),
                        "additionalProperties", false
                    )
                );

                JsonNode result = llmPort.callLlmWithStrictSchema(systemPrompt, userPrompt, jsonSchema);
                if (result != null && result.has("logPath")) {
                    String path = result.get("logPath").asText().trim();
                    if (!path.isBlank() && path.startsWith("/")) {
                        logger.info("[LogPathInference] LLM Strict Structured Output inferred log path: {}", path);
                        return path;
                    }
                }
            } catch (Exception e) {
                logger.warn("[LogPathInference] LLM inference failed, falling back to rules: {}", e.getMessage());
            }
        }

        // Structural Rule-based Fallback
        if (repoConfigFileContent != null && !repoConfigFileContent.isBlank()) {
            if (repoConfigFileContent.contains("logging.file.name") || repoConfigFileContent.contains("logging.file.path")) {
                return "/var/log/spring/application.log";
            }
            if (repoConfigFileContent.contains("pm2.config.js") || repoConfigFileContent.contains("out_file") || repoConfigFileContent.contains("error_file")) {
                return "/var/log/node/app.log";
            }
        }

        if (filenames != null) {
            if (filenames.contains("build.gradle.kts") || filenames.contains("build.gradle") || filenames.contains("pom.xml")) {
                return "/var/log/spring/*.log, /var/log/application.log";
            }
            if (filenames.contains("package.json")) {
                return "/var/log/node/*.log, /var/log/app.log";
            }
            if (filenames.contains("requirements.txt") || filenames.contains("pytest.ini") || filenames.contains("pyproject.toml")) {
                return "/var/log/python/*.log, /var/log/app.log";
            }
            if (filenames.contains("go.mod")) {
                return "/var/log/go/*.log";
            }
        }

        return "/var/log/production/*.log";
    }
}
