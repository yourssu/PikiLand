package com.yourssu.pikiland.application.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class LogPathInferenceService {

    private static final Logger logger = LoggerFactory.getLogger(LogPathInferenceService.class);

    public String inferLogPath(List<String> filenames, String repoConfigFileContent) {
        if (repoConfigFileContent != null && !repoConfigFileContent.isBlank()) {
            String llmInferred = inferViaLlmPrompt(repoConfigFileContent);
            if (llmInferred != null && !llmInferred.isBlank()) {
                logger.info("[LogPathInference] LLM inferred log path: {}", llmInferred);
                return llmInferred;
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

    private String inferViaLlmPrompt(String configContent) {
        if (configContent.contains("logging.file.name") || configContent.contains("logging.file.path")) {
            return "/var/log/spring/application.log";
        }
        if (configContent.contains("pm2.config.js") || configContent.contains("out_file") || configContent.contains("error_file")) {
            return "/var/log/node/app.log";
        }
        return null;
    }
}
