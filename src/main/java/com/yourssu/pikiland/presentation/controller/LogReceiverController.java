package com.yourssu.pikiland.presentation.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourssu.pikiland.application.service.LogIngestService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/logs")
public class LogReceiverController {

    private static final Logger logger = LoggerFactory.getLogger(LogReceiverController.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

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
            @RequestBody(required = false) Object rawPayload) {

        // 1. Bearer Token Verification
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            logger.warn("[LogReceiver] Missing or invalid Authorization header format.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("status", "error", "message", "Unauthorized token"));
        }

        String token = authHeader.substring(7).trim();
        if (!validToken.equals(token)) {
            logger.warn("[LogReceiver] Token mismatch. Received token does not match valid token.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("status", "error", "message", "Unauthorized token"));
        }

        if (rawPayload == null) {
            return ResponseEntity.ok(Map.of("status", "success", "processed_records", 0));
        }

        List<Map<String, Object>> payloads = new ArrayList<>();

        try {
            if (rawPayload instanceof List<?> list) {
                for (Object item : list) {
                    if (item instanceof Map<?, ?> map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> casted = (Map<String, Object>) map;
                        payloads.add(casted);
                    }
                }
            } else if (rawPayload instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> casted = (Map<String, Object>) map;
                payloads.add(casted);
            } else if (rawPayload instanceof String strPayload) {
                strPayload = strPayload.trim();
                if (strPayload.startsWith("[")) {
                    List<?> list = objectMapper.readValue(strPayload, List.class);
                    for (Object item : list) {
                        if (item instanceof Map<?, ?> map) {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> casted = (Map<String, Object>) map;
                            payloads.add(casted);
                        }
                    }
                } else if (strPayload.startsWith("{")) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> map = objectMapper.readValue(strPayload, Map.class);
                    payloads.add(map);
                } else {
                    // Preserve full multiline log context (preceding lines + error stack trace)
                    payloads.add(Map.of("log", strPayload));
                }
            }

            // 2. Process Ingested Logs
            int processedRecords = logIngestService.processIngestedLogs(repoHeader, payloads);
            return ResponseEntity.ok(Map.of("status", "success", "processed_records", processedRecords));

        } catch (Exception e) {
            logger.error("[LogReceiver] Error processing log payload", e);
            return ResponseEntity.badRequest().body(Map.of("status", "error", "message", "Invalid log payload"));
        }
    }
}
