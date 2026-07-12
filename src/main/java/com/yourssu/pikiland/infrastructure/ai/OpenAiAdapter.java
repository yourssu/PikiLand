package com.yourssu.pikiland.infrastructure.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.PatchInstruction;
import com.yourssu.pikiland.domain.port.AiAgentPort;
import com.yourssu.pikiland.domain.port.WorkspacePort;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Path;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class OpenAiAdapter implements AiAgentPort {

    private final String baseUrl;
    private final String apiKey;
    private final String defaultModel;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public OpenAiAdapter(
            @Value("${app.ai.base-url}") String baseUrl,
            @Value("${app.ai.api-key:}") String apiKey,
            @Value("${app.ai.model:gpt-4o}") String defaultModel,
            Optional<RestTemplate> restTemplateOpt) { // Injected Optional RestTemplate
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.restTemplate = restTemplateOpt.orElseGet(RestTemplate::new);
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public AiAnalysisResult analyzeError(String logContent, String eventType, Path workspace, WorkspacePort workspacePort, String customModel) {
        String model = (customModel != null && !customModel.isBlank()) ? customModel : defaultModel;
        
        System.out.println("Starting AI diagnostics using model: " + model);
        
        String systemPrompt = "당신은 시니어 데브옵스(DevOps) 엔지니어이자 풀스택 소프트웨어 엔지니어입니다. 제공되는 로그 또는 이슈 데이터를 분석하여, 에러의 해결 방안과 자동 패치 여부를 결정해야 합니다.\n\n" +
                "당신은 오류의 맥락을 정확히 이해하기 위해 프로젝트 워크스페이스의 디렉토리와 파일을 탐색할 수 있는 도구(Tools)를 사용할 수 있습니다.\n" +
                "모든 분석이 완료되면 반드시 정의된 JSON 스키마를 엄격히 준수하여 응답해야 합니다.\n" +
                "특히 'summary'와 'impact' 항목은 비개발자(기획자, PM, 운영팀 등)가 즉시 이해할 수 있도록 전문적인 IT 용어를 배제하거나 풀어서 설명하고 극도로 객관적으로 작성해 주십시오.\n" +
                "또한 'patch_summary' 항목은 자동 패치(PR)가 생성될 시(pr_needed가 true인 경우) 무엇을 어떻게 고쳤는지 비개발자가 이해할 수 있도록 쉬운 설명글로 설명해 주십시오. 만약 패치가 필요 없거나 생성하지 않을 경우 빈 문자열(\"\")로 작성해 주십시오.\n\n" +
                "⚠️ [중요 - 코드 자동 패치 생성 시 엄격한 근본 치료 규칙]\n" +
                "1. **임시 땜질식(Dummy/Workaround) 대처 금지**: 단순히 에러 메시지만 안 나타나게 덮기 위해, 선언되지 않은 객체를 엉뚱한 임시 문자열(\"test\")이나 Null 혹은 스터브(stub) 값으로 성급하게 치환하는 행위를 엄격히 금지합니다.\n" +
                "2. **근본적이고 안전한 수정**: 클래스나 라이브러리 임포트 누락의 경우, 실제 해당 클래스를 올바르게 임포트하거나 의존성을 매핑해야 합니다. 코드의 제어 흐름에 예외가 발생한다면, 단순히 코드를 지우거나 빈 값으로 덮지 말고 정확한 Null 가드 조건이나 안전한 경계값 처리를 추가하여 로직을 온전하게 작동시켜야 합니다.\n" +
                "3. **연쇄 영향 파악**: 수정하는 코드가 프로젝트 전체의 연관 비즈니스 흐름이나 다른 파일에 연쇄적인 논리적 장애(Side Effect)를 일으키지 않을지 신중히 분석하십시오.\n" +
                "4. **해결책의 불명확성 인지**: 로그나 정보가 부족하여 완전하고 근본적인 해결 코드를 작성할 수 없거나, 소스 코드 수정만으로는 불가능한 환경/인프라성 장애인 경우, 절대로 'is_confident' 및 'pr_needed'를 true로 지정하지 말고 false로 둔 채 상세 진단만 제공하십시오. 100% 확실하고 부작용 없는 안전한 근본 코드 수정만 PR로 이어져야 합니다.";

        String userPrompt = "이벤트 유형: " + eventType + "\n\n[분석할 데이터]\n" + logContent;

        List<Map<String, Object>> messages = new ArrayList<>();
        
        Map<String, Object> sysMsg = new HashMap<>();
        sysMsg.put("role", "system");
        sysMsg.put("content", systemPrompt);
        messages.add(sysMsg);

        Map<String, Object> userMsg = new HashMap<>();
        userMsg.put("role", "user");
        userMsg.put("content", userPrompt);
        messages.add(userMsg);

        String rawResultJson = null;
        boolean success = false;

        // Try 3 times using Structured Outputs
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                System.out.println("Attempting AI completion (Try " + attempt + "/3)...");
                rawResultJson = runAgenticLoop(messages, model, workspace, workspacePort, true);
                success = true;
                break;
            } catch (Exception e) {
                System.err.println("Structured Output attempt " + attempt + " failed: " + e.getMessage());
            }
        }

        // Fallback to text completion
        if (!success) {
            System.out.println("Falling back to standard text completion...");
            String fallbackPrompt = systemPrompt + "\n반드시 다음 구조의 JSON 형식으로만 응답해 주십시오. (마크다운 ```json ... ``` 블록으로 감싸서 출력하세요).";
            messages.get(0).put("content", fallbackPrompt);

            for (int attempt = 1; attempt <= 3; attempt++) {
                try {
                    System.out.println("Attempting Fallback Completion (Try " + attempt + "/3)...");
                    rawResultJson = runAgenticLoop(messages, model, workspace, workspacePort, false);
                    success = true;
                    break;
                } catch (Exception fe) {
                    System.err.println("Fallback attempt " + attempt + " failed: " + fe.getMessage());
                }
            }
        }

        if (!success || rawResultJson == null) {
            return buildErrorResult("⚠️ AI 분석 호출 또는 데이터 파싱에 실패했습니다.");
        }

        try {
            String sanitized = sanitizeJsonString(rawResultJson);
            JsonNode root = objectMapper.readTree(sanitized);

            boolean isConfident = root.path("is_confident").asBoolean();
            String summary = root.path("summary").asText();
            String impact = root.path("impact").asText();
            String causeDescription = root.path("cause_description").asText();
            boolean prNeeded = root.path("pr_needed").asBoolean();
            String patchSummary = root.path("patch_summary").asText();
            String prTitle = root.path("pr_title").asText();
            String prBody = root.path("pr_body").asText();

            List<PatchInstruction> patches = new ArrayList<>();
            JsonNode patchNodes = root.path("patch_instructions");
            if (patchNodes.isArray()) {
                for (JsonNode patchNode : patchNodes) {
                    patches.add(new PatchInstruction(
                            patchNode.path("file_path").asText(),
                            patchNode.path("old_code").asText(),
                            patchNode.path("new_code").asText()
                    ));
                }
            }

            return new AiAnalysisResult(isConfident, summary, impact, causeDescription, prNeeded, patchSummary, patches, prTitle, prBody);

        } catch (Exception e) {
            System.err.println("Failed to parse JSON schema: " + e.getMessage());
            System.err.println("Raw response: " + rawResultJson);
            return buildErrorResult("⚠️ AI 응답 데이터의 구조화된 파싱에 실패했습니다. 에러: " + e.getMessage());
        }
    }

    private String runAgenticLoop(List<Map<String, Object>> messages, String model, Path workspace, WorkspacePort workspacePort, boolean useStructured) throws Exception {
        Map<String, Integer> toolCallHistory = new HashMap<>();
        int iteration = 0;

        while (true) {
            iteration++;
            System.out.println(" -> Agentic Loop Iteration " + iteration);

            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("model", model);
            requestBody.put("messages", messages);
            requestBody.put("temperature", 0.2);
            requestBody.put("tools", getToolsDefinitions());

            if (useStructured) {
                requestBody.put("response_format", getResponseSchema());
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("Authorization", "Bearer " + apiKey);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            ResponseEntity<String> response = restTemplate.postForEntity(baseUrl + "/chat/completions", entity, String.class);

            if (response.getStatusCode() != HttpStatus.OK) {
                throw new RuntimeException("API Call failed: " + response.getStatusCode() + " - " + response.getBody());
            }

            JsonNode responseRoot = objectMapper.readTree(response.getBody());
            JsonNode choiceNode = responseRoot.path("choices").get(0);
            JsonNode messageNode = choiceNode.path("message");

            JsonNode toolCalls = messageNode.path("tool_calls");
            if (toolCalls.isArray() && toolCalls.size() > 0) {
                Map<String, Object> assistantMsg = new HashMap<>();
                assistantMsg.put("role", "assistant");
                
                List<Map<String, Object>> toolCallList = new ArrayList<>();
                for (JsonNode tc : toolCalls) {
                    Map<String, Object> tcMap = new HashMap<>();
                    tcMap.put("id", tc.path("id").asText());
                    tcMap.put("type", tc.path("type").asText());
                    
                    Map<String, Object> funcMap = new HashMap<>();
                    funcMap.put("name", tc.path("function").path("name").asText());
                    funcMap.put("arguments", tc.path("function").path("arguments").asText());
                    tcMap.put("function", funcMap);
                    
                    toolCallList.add(tcMap);
                }
                
                assistantMsg.put("tool_calls", toolCallList);
                if (!messageNode.path("content").isNull()) {
                    assistantMsg.put("content", messageNode.path("content").asText());
                }
                messages.add(assistantMsg);

                for (JsonNode toolCall : toolCalls) {
                    String callId = toolCall.path("id").asText();
                    String funcName = toolCall.path("function").path("name").asText();
                    String funcArgs = toolCall.path("function").path("arguments").asText();

                    String callKey = funcName + ":" + funcArgs;
                    toolCallHistory.put(callKey, toolCallHistory.getOrDefault(callKey, 0) + 1);

                    if (toolCallHistory.get(callKey) >= 5) {
                        throw new RuntimeException("Infinite loop detected: tool " + funcName + " was called repeatedly 5 times with args " + funcArgs);
                    }

                    System.out.println("   [Tool Call] " + funcName + " args: " + funcArgs);
                    JsonNode argsObj = objectMapper.readTree(funcArgs);
                    String result = "";

                    if ("list_directory".equals(funcName)) {
                        String dirPath = argsObj.path("directory_path").asText(".");
                        result = workspacePort.listDirectory(workspace, dirPath);
                    } else if ("read_file_content".equals(funcName)) {
                        String filePath = argsObj.path("file_path").asText();
                        result = workspacePort.readFile(workspace, filePath);
                    } else if ("grep_in_file".equals(funcName)) {
                        String filePath = argsObj.path("file_path").asText();
                        String query = argsObj.path("query").asText();
                        result = workspacePort.grepInFile(workspace, filePath, query);
                    } else {
                        result = "Error: Tool " + funcName + " is not recognized.";
                    }

                    Map<String, Object> toolResponse = new HashMap<>();
                    toolResponse.put("role", "tool");
                    toolResponse.put("tool_call_id", callId);
                    toolResponse.put("name", funcName);
                    toolResponse.put("content", result);
                    messages.add(toolResponse);
                }
            } else {
                return messageNode.path("content").asText();
            }
        }
    }

    private String sanitizeJsonString(String rawText) {
        String jsonStr = "";
        Pattern p = Pattern.compile("```(?:json)?\\s*(.*?)\\s*```", Pattern.DOTALL | Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(rawText);
        if (m.find()) {
            jsonStr = m.group(1);
        } else {
            int firstBrace = rawText.indexOf("{");
            int lastBrace = rawText.lastIndexOf("}");
            if (firstBrace != -1 && lastBrace != -1) {
                jsonStr = rawText.substring(firstBrace, lastBrace + 1);
            } else {
                jsonStr = rawText.trim();
            }
        }

        jsonStr = jsonStr.replaceAll("/\\*.*?\\*/", "");
        String[] lines = jsonStr.split("\\r?\\n");
        List<String> cleanedLines = new ArrayList<>();
        for (String line : lines) {
            String cleanedLine = line.replaceAll("(?<!https)(?<!http)(?<!:)//.*$", "");
            cleanedLines.add(cleanedLine);
        }
        jsonStr = String.join("\n", cleanedLines);
        jsonStr = jsonStr.replaceAll(",\\s*([\\}\\],])", "$1");

        return jsonStr.trim();
    }

    private List<Map<String, Object>> getToolsDefinitions() {
        List<Map<String, Object>> tools = new ArrayList<>();

        Map<String, Object> t1 = new HashMap<>();
        t1.put("type", "function");
        Map<String, Object> f1 = new HashMap<>();
        f1.put("name", "list_directory");
        f1.put("description", "Lists subdirectories and files in a single-level folder path inside the project workspace.");
        Map<String, Object> p1 = new HashMap<>();
        p1.put("type", "object");
        Map<String, Object> prop1 = new HashMap<>();
        Map<String, Object> dirPathProp = new HashMap<>();
        dirPathProp.put("type", "string");
        dirPathProp.put("description", "Relative directory path from project root (e.g. '.', 'src', 'src/main/java'). Defaults to '.'.");
        prop1.put("directory_path", dirPathProp);
        p1.put("properties", prop1);
        f1.put("parameters", p1);
        t1.put("function", f1);
        tools.add(t1);

        Map<String, Object> t2 = new HashMap<>();
        t2.put("type", "function");
        Map<String, Object> f2 = new HashMap<>();
        f2.put("name", "read_file_content");
        f2.put("description", "Reads the source code content of a specific file in the workspace.");
        Map<String, Object> p2 = new HashMap<>();
        p2.put("type", "object");
        Map<String, Object> prop2 = new HashMap<>();
        Map<String, Object> filePathProp = new HashMap<>();
        filePathProp.put("type", "string");
        filePathProp.put("description", "Relative file path from project root (e.g. 'src/test/java/DemoApplicationTests.java').");
        prop2.put("file_path", filePathProp);
        p2.put("properties", prop2);
        p2.put("required", Arrays.asList("file_path"));
        f2.put("parameters", p2);
        t2.put("function", f2);
        tools.add(t2);

        Map<String, Object> t3 = new HashMap<>();
        t3.put("type", "function");
        Map<String, Object> f3 = new HashMap<>();
        f3.put("name", "grep_in_file");
        f3.put("description", "Searches for a specific query or symbol inside a single file to locate reference details.");
        Map<String, Object> p3 = new HashMap<>();
        p3.put("type", "object");
        Map<String, Object> prop3 = new HashMap<>();
        Map<String, Object> pathProp = new HashMap<>();
        pathProp.put("type", "string");
        pathProp.put("description", "Relative file path from project root.");
        Map<String, Object> queryProp = new HashMap<>();
        queryProp.put("type", "string");
        queryProp.put("description", "The exact term or symbol to search for (e.g. 'User').");
        prop3.put("file_path", pathProp);
        prop3.put("query", queryProp);
        p3.put("properties", prop3);
        p3.put("required", Arrays.asList("file_path", "query"));
        f3.put("parameters", p3);
        t3.put("function", f3);
        tools.add(t3);

        return tools;
    }

    private Map<String, Object> getResponseSchema() {
        Map<String, Object> resFormat = new HashMap<>();
        resFormat.put("type", "json_schema");

        Map<String, Object> jsonSchema = new HashMap<>();
        jsonSchema.put("name", "error_analysis");
        jsonSchema.put("strict", true);

        Map<String, Object> schema = new HashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new HashMap<>();
        properties.put("is_confident", Map.of("type", "boolean"));
        properties.put("summary", Map.of("type", "string", "description", "에러 핵심 요약 (비개발자용)"));
        properties.put("impact", Map.of("type", "string", "description", "장애 전파 범위 및 영향도 (비개발자용)"));
        properties.put("cause_description", Map.of("type", "string", "description", "기술적 분석 및 수정 방안 (개발자 마크다운)"));
        properties.put("pr_needed", Map.of("type", "boolean"));
        properties.put("patch_summary", Map.of("type", "string", "description", "수정 요약 (비개발자용)"));

        Map<String, Object> patchInstructions = new HashMap<>();
        patchInstructions.put("type", "array");
        Map<String, Object> items = new HashMap<>();
        items.put("type", "object");
        Map<String, Object> itemProps = new HashMap<>();
        itemProps.put("file_path", Map.of("type", "string"));
        itemProps.put("old_code", Map.of("type", "string"));
        itemProps.put("new_code", Map.of("type", "string"));
        items.put("properties", itemProps);
        items.put("required", Arrays.asList("file_path", "old_code", "new_code"));
        items.put("additionalProperties", false);
        patchInstructions.put("items", items);
        properties.put("patch_instructions", patchInstructions);

        properties.put("pr_title", Map.of("type", "string"));
        properties.put("pr_body", Map.of("type", "string"));

        schema.put("properties", properties);
        schema.put("required", Arrays.asList(
                "is_confident", "summary", "impact", "cause_description",
                "pr_needed", "patch_summary", "patch_instructions", "pr_title", "pr_body"
        ));
        schema.put("additionalProperties", false);

        jsonSchema.put("schema", schema);
        resFormat.put("json_schema", jsonSchema);

        return resFormat;
    }

    private AiAnalysisResult buildErrorResult(String msg) {
        return new AiAnalysisResult(false, msg, "오류가 발생하여 분석하지 못했습니다.", "", false, "", Collections.emptyList(), "", "");
    }
}
