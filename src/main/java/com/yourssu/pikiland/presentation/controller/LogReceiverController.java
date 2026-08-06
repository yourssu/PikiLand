package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.LogIngestService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/logs")
public class LogReceiverController {

    private static final Logger logger = LoggerFactory.getLogger(LogReceiverController.class);

    @Value("${app.log-receiver.token:your_secure_agent_token_here}")
    private String validToken;

    private final LogIngestService logIngestService;

    public LogReceiverController(LogIngestService logIngestService) {
        this.logIngestService = logIngestService;
    }

    @PostMapping("/ingest")
    public ResponseEntity<?> ingestLogs(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @RequestHeader(value = "X-Pikiland-Repo", required = false) String repoHeader,
            @RequestBody List<Map<String, Object>> payloads) {

        // 1. Bearer Token Verification
        if (authHeader == null || !authHeader.startsWith("Bearer ") ||
            !validToken.equals(authHeader.substring(7))) {
            logger.warn("[LogReceiver] Unauthorized log ingestion attempt.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Unauthorized token");
        }

        try {
            // 2. Process Fluent Bit JSON Payload
            int processedRecords = logIngestService.processIngestedLogs(repoHeader, payloads);
            return ResponseEntity.ok(Map.of("status", "success", "processed_records", processedRecords));

        } catch (Exception e) {
            logger.error("[LogReceiver] Error processing log payload", e);
            return ResponseEntity.badRequest().body("Invalid log payload");
        }
    }
}
