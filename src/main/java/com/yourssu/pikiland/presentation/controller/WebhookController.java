package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.WebhookAppService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class WebhookController {

    private final WebhookAppService webhookAppService;

    public WebhookController(WebhookAppService webhookAppService) {
        this.webhookAppService = webhookAppService;
    }

    @PostMapping(value = {"/webhook", "/webhook/", "/api/webhook", "/api/webhook/"})
    public ResponseEntity<String> handleWebhook(
            @RequestBody String payload,
            @RequestHeader(value = "X-GitHub-Event", required = false) String event,
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature) {

        String safeEvent = (event != null) ? event : "unknown";
        System.out.println("[Webhook Controller] Incoming HTTP POST from GitHub. Event: '" + safeEvent + "', Signature Header Present: " + (signature != null));

        boolean trusted = webhookAppService.handleEvent(safeEvent, payload, signature);
        if (!trusted) {
            System.err.println("[Webhook Controller] REJECTED — Webhook signature verification failed for event: " + safeEvent);
            return ResponseEntity.status(org.springframework.http.HttpStatus.UNAUTHORIZED).body("Invalid signature");
        }
        return ResponseEntity.ok("Accepted");
    }
}
