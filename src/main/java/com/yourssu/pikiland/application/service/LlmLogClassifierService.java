package com.yourssu.pikiland.application.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.regex.Pattern;

@Service
public class LlmLogClassifierService {

    private static final Logger logger = LoggerFactory.getLogger(LlmLogClassifierService.class);

    @Value("${app.debug:false}")
    private boolean isDebug;

    // Pattern to check for genuine stack trace elements or system exception signatures
    private static final Pattern STACK_TRACE_PATTERN = Pattern.compile(
            "(?i)(java\\.lang\\.\\w+Exception|\\w+Exception|\\w+Error|at\\s+[a-zA-Z0-9_\\.]+\\([a-zA-Z0-9_]+\\.java:\\d+\\)|FATAL|CRITICAL|5\\d{2}\\s+Internal\\s+Server\\s+Error)"
    );

    /**
     * Stage 2 Log Verification: Classifies whether an ingested log entry represents a genuine system error/exception
     * that requires self-healing, filtering out benign user inputs (e.g., text simply containing "500").
     */
    public boolean isGenuineSystemError(String logContent) {
        if (logContent == null || logContent.isBlank()) {
            return false;
        }

        // Rule-based heuristic check for stack trace structure
        boolean hasStackTracePattern = STACK_TRACE_PATTERN.matcher(logContent).find();

        // If the log is just a benign string with number 500 (e.g. "User typed 500 items"), reject it.
        if (isBenignUserInputText(logContent)) {
            logger.info("[LlmClassifier] Log classified as BENIGN USER INPUT (Rejected): '{}'", logContent);
            return false;
        }

        if (hasStackTracePattern) {
            logger.info("[LlmClassifier] Log classified as GENUINE SYSTEM ERROR (Accepted)");
            return true;
        }

        logger.info("[LlmClassifier] Log rejected: Does not match error signature");
        return false;
    }

    private boolean isBenignUserInputText(String logContent) {
        String lower = logContent.toLowerCase();
        // If it contains "500" but lacks any Exception, Error, or 'at ' stack trace line, classify as benign input.
        if (lower.contains("500") && !lower.contains("exception") && !lower.contains("error") && !lower.contains("fatal") && !lower.contains("at ")) {
            return true;
        }
        return false;
    }
}
