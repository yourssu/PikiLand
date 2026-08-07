package com.yourssu.pikiland.infrastructure.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourssu.pikiland.domain.model.SystemSettings;
import com.yourssu.pikiland.domain.port.SystemSettingsRepository;
import com.yourssu.pikiland.domain.port.LlmPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class LlmClientService implements LlmPort {

    private static final Logger logger = LoggerFactory.getLogger(LlmClientService.class);

    private final SystemSettingsRepository systemSettingsRepository;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Value("${app.ai.openai-api-key:}")
    private String envApiKey;

    @Value("${app.ai.openai-base-url:https://api.openai.com/v1}")
    private String envBaseUrl;

    @Value("${app.ai.model:gpt-4o}")
    private String envModelName;

    @Autowired
    public LlmClientService(@Autowired(required = false) SystemSettingsRepository systemSettingsRepository) {
        this.systemSettingsRepository = systemSettingsRepository;
        this.restTemplate = new RestTemplate();
        this.objectMapper = new ObjectMapper();
    }

    public JsonNode callLlmWithStrictSchema(String systemPrompt, String userPrompt, Map<String, Object> jsonSchemaObject) {
        String effectiveApiKey = envApiKey;
        String effectiveBaseUrl = envBaseUrl;
        String effectiveModel = envModelName;

        if (systemSettingsRepository != null) {
            Optional<SystemSettings> sysOpt = systemSettingsRepository.findGlobalSettings();
            if (sysOpt.isPresent()) {
                SystemSettings sys = sysOpt.get();
                if (sys.getGlobalAiApiKey() != null && !sys.getGlobalAiApiKey().isBlank()) {
                    effectiveApiKey = sys.getGlobalAiApiKey();
                }
                if (sys.getGlobalAiBaseUrl() != null && !sys.getGlobalAiBaseUrl().isBlank()) {
                    effectiveBaseUrl = sys.getGlobalAiBaseUrl();
                }
                if (sys.getGlobalAiModel() != null && !sys.getGlobalAiModel().isBlank()) {
                    effectiveModel = sys.getGlobalAiModel();
                }
            }
        }

        if (effectiveApiKey == null || effectiveApiKey.isBlank()) {
            logger.debug("[LlmClient] No Server Global LLM API Key configured. Skipping call.");
            return null;
        }

        try {
            String baseUrlClean = effectiveBaseUrl.trim();
            String endpoint = baseUrlClean.endsWith("/") ? baseUrlClean + "chat/completions" : baseUrlClean + "/chat/completions";
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("Authorization", "Bearer " + effectiveApiKey.trim());

            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", effectiveModel.trim());
            requestBody.put("messages", List.of(
                Map.of("role", "system", "content", systemPrompt),
                Map.of("role", "user", "content", userPrompt)
            ));
            requestBody.put("temperature", 0.0);

            if (jsonSchemaObject != null && !jsonSchemaObject.isEmpty()) {
                requestBody.put("response_format", Map.of(
                    "type", "json_schema",
                    "json_schema", jsonSchemaObject
                ));
            }

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            ResponseEntity<String> response = restTemplate.exchange(endpoint, HttpMethod.POST, entity, String.class);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                JsonNode root = objectMapper.readTree(response.getBody());
                JsonNode contentNode = root.path("choices").path(0).path("message").path("content");
                if (!contentNode.isMissingNode()) {
                    return objectMapper.readTree(contentNode.asText());
                }
            }
        } catch (Exception e) {
            logger.warn("[LlmClient] AI Provider Strict Structured Output call failed: {}", e.getMessage());
        }
        return null;
    }
}
