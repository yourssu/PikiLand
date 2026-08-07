package com.yourssu.pikiland.domain.port;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

public interface LlmPort {
    JsonNode callLlmWithStrictSchema(String systemPrompt, String userPrompt, Map<String, Object> jsonSchemaObject);
}
