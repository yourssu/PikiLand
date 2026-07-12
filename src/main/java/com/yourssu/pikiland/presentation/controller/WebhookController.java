package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.WebhookAppService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/webhook")
public class WebhookController {

    private final WebhookAppService webhookAppService;

    public WebhookController(WebhookAppService webhookAppService) {
        this.webhookAppService = webhookAppService;
    }

    @PostMapping
    public ResponseEntity<String> handleWebhook(
            @RequestBody String payload,
            @RequestHeader("X-GitHub-Event") String event,
            @RequestHeader(value = "X-Hub-Signature-256", required = false) String signature) {
        
        webhookAppService.handleEvent(event, payload, signature);
        return ResponseEntity.ok("Accepted");
    }
}
