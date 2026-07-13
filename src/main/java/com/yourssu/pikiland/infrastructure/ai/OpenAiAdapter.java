package com.yourssu.pikiland.infrastructure.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.PatchInstruction;
import com.yourssu.pikiland.domain.model.PrCandidate;
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
        this.restTemplate = restTemplateOpt.orElseGet(() -> {
            org.springframework.http.client.SimpleClientHttpRequestFactory factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
            factory.setConnectTimeout(10000);
            factory.setReadTimeout(60000);
            return new RestTemplate(factory);
        });
        this.objectMapper = new ObjectMapper();
    }

    @Override
    public AiAnalysisResult analyzeError(String logContent, String eventType, Path workspace, WorkspacePort workspacePort, String customModel) {
        String model = (customModel != null && !customModel.isBlank()) ? customModel : defaultModel;
        
        System.out.println("Starting AI diagnostics using model: " + model);
        
        String systemPrompt = "당신은 시니어 데브옵스(DevOps) 엔지니어이자 풀스택 소프트웨어 엔지니어입니다. 제공되는 로그 또는 이슈 데이터를 분석하여, 에러의 해결 방안과 자동 패치 여부를 결정해야 합니다.\n\n" +
                "당신은 오류의 맥락을 정확히 이해하기 위해 프로젝트 워크스페이스의 디렉토리와 파일을 탐색할 수 있는 도구(Tools)를 사용할 수 있습니다.\n" +
                "모든 분석이 완료되면 반드시 정의된 JSON 스키마를 엄격히 준수하여 응답해야 합니다.\n\n" +
                "🌐 [언어 규칙]\n" +
                "모든 응답 필드('summary', 'impact', 'cause_description', 'patch_summary', 'pr_title', 'pr_body')는 반드시 **한국어**로만 작성하십시오.\n\n" +
                "📢 [Slack 알림 용 - 비개발자 대상 필드 규칙]\n" +
                "1. 'summary', 'impact', 'patch_summary' 필드는 기획자, PM, 운영팀 등 **비개발자**를 대상으로 합니다.\n" +
                "2. 개발/IT 전문 용어(예: NullPointerException, StackTrace, DB Connection Pool, Exception 등)를 최대한 배제하거나 한글로 아주 쉽게 풀어서 설명해 주십시오.\n" +
                "3. 객관적이고 단순 명료하게 비개발자가 시스템 장애 현상과 고쳐진 방향을 한눈에 파악할 수 있게 하십시오.\n\n" +
                "💻 [GitHub PR 용 - 개발자 대상 필드 규칙]\n" +
                "1. 각 PR 후보('pr_candidates') 내의 'pr_title'과 'pr_body'는 코드 검토를 진행할 **개발자**들을 대상으로 합니다.\n" +
                "2. 에러의 기술적 원인, 스택 트레이스 상의 문제 지점, 수정사항의 기술적 타당성, 사이드 이펙트(부작용) 가능성 등을 개발자 전문 용어를 적극 사용하여 상세히 서술하십시오.\n" +
                "3. 필요 시 수정 코드 스니펫이나 원본 로그 스니펫을 PR 본문에 마크다운으로 포함시켜 개발자가 바로 검토할 수 있게 하십시오.\n\n" +
                "🤖 [중요 - PR 후보군(Candidates) 생성 규칙]\n" +
                "에러를 해결하기 위해 최대 3개의 서로 다른 PR 수정 후보(1개 ~ 3개)를 생성하십시오. 각 후보는 서로 다른 접근 방식이거나, 가장 유력한 시도들이어야 합니다. 당신이 해결책에 확신이 부족하더라도 사람이 검토할 수 있도록 가능한 한 PR 후보들을 3개까지 구체적으로 제안하여 'pr_candidates' 배열에 담아 주십시오.\n\n" +
                "⚠️ [중요 - 코드 자동 패치 생성 시 엄격한 근본 치료 규칙]\n" +
                "1. **임시 땜질식(Dummy/Workaround) 대처 금지**: 단순히 에러 메시지만 안 나타나게 덮기 위해, 선언되지 않은 객체를 엉뚱한 임시 문자열(\"test\")이나 Null 혹은 스터브(stub) 값으로 성급하게 치환하는 행위를 엄격히 금지합니다.\n" +
                "2. **근본적이고 안전한 수정**: 클래스나 라이브러리 임포트 누락의 경우, 실제 해당 클래스를 올바르게 임포트하거나 의존성을 매핑해야 합니다. 코드의 제어 흐름에 예외가 발생한다면, 단순히 코드를 지우거나 빈 값으로 덮지 말고 정확한 Null 가드 조건이나 안전한 경계값 처리를 추가하여 로직을 온전하게 작동시켜야 합니다.\n" +
                "3. **연쇄 영향 파악**: 수정하는 코드가 프로젝트 전체의 연관 비즈니스 흐름이나 다른 파일에 연쇄적인 논리적 장애(Side Effect)를 일으키지 않을지 신중히 분석하십시오.\n" +
                "4. **해결책의 불명확성 인지**: 로그나 정보가 부족하여 완전하고 근본적인 해결 코드를 제어할 수 없거나, 소스 코드 수정만으로는 불가능한 환경/인프라성 장애인 경우, 절대로 'pr_needed'를 true로 지정하지 말고 false로 둔 채 상세 진단만 제공하십시오. 100% 해결 방안이 불분명하더라도 코드 수정으로 고칠 여지가 있고 제안할 후보가 있다면 'pr_needed'를 true로 설정하고 후보군들을 제안하십시오.";

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

        // Dynamic loop budget: proportional to repo size so tiny repos aren't over-charged
        // and large repos still have enough room to explore deeply.
        // Formula: min(60, 15 + fileCount / 30)
        //   10 files  → 15 iterations (minimum)
        //   300 files → 25 iterations
        //   900 files → 45 iterations
        //  1350+ files → 60 iterations (cap)
        int fileCount = workspacePort.countSourceFiles(workspace);
        int maxIterations = Math.min(60, 15 + (fileCount / 30));
        System.out.println("[AI] Repo source file count: " + fileCount +
                " → dynamic agent loop cap: " + maxIterations + " iterations");

        // Try 3 times using Structured Outputs
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                System.out.println("Attempting AI completion (Try " + attempt + "/3)...");
                rawResultJson = runAgenticLoop(messages, model, workspace, workspacePort, true, maxIterations);
                success = true;
                break;
            } catch (Exception e) {
                System.err.println("Structured Output attempt " + attempt + " failed: " + e.getMessage());
            }
        }

        // Fallback to standard text completion (no structured output schema)
        if (!success) {
            System.out.println("Falling back to standard text completion...");
            String fallbackPrompt = systemPrompt + "\n반드시 다음 구조의 JSON 형식으로만 응답해 주십시오. (마크다운 ```json ... ``` 블록으로 감싸서 출력하세요).\n" +
                    "{\n" +
                    "  \"is_confident\": true/false,\n" +
                    "  \"summary\": \"...\",\n" +
                    "  \"impact\": \"...\",\n" +
                    "  \"cause_description\": \"...\",\n" +
                    "  \"pr_needed\": true/false,\n" +
                    "  \"pr_candidates\": [\n" +
                    "    {\n" +
                    "      \"patch_summary\": \"...\",\n" +
                    "      \"pr_title\": \"...\",\n" +
                    "      \"pr_body\": \"...\",\n" +
                    "      \"patch_instructions\": [\n" +
                    "        {\n" +
                    "          \"file_path\": \"...\",\n" +
                    "          \"old_code\": \"...\",\n" +
                    "          \"new_code\": \"...\"\n" +
                    "        }\n" +
                    "      ]\n" +
                    "    }\n" +
                    "  ]\n" +
                    "}";
            
            List<Map<String, Object>> fallbackMessages = new ArrayList<>(messages);
            fallbackMessages.get(0).put("content", fallbackPrompt);

            for (int attempt = 1; attempt <= 3; attempt++) {
                try {
                    System.out.println("Attempting Fallback Completion (Try " + attempt + "/3)...");
                    rawResultJson = runAgenticLoop(fallbackMessages, model, workspace, workspacePort, false, maxIterations);
                    success = true;
                    break;
                } catch (Exception e) {
                    System.err.println("Fallback completion also failed: " + e.getMessage());
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

            List<PrCandidate> prCandidates = new ArrayList<>();
            JsonNode candidateNodes = root.path("pr_candidates");
            if (candidateNodes.isArray()) {
                for (JsonNode candidateNode : candidateNodes) {
                    List<PatchInstruction> patches = new ArrayList<>();
                    JsonNode patchNodes = candidateNode.path("patch_instructions");
                    if (patchNodes.isArray()) {
                        for (JsonNode patchNode : patchNodes) {
                            patches.add(new PatchInstruction(
                                    patchNode.path("file_path").asText(),
                                    patchNode.path("old_code").asText(),
                                    patchNode.path("new_code").asText()
                            ));
                        }
                    }
                    prCandidates.add(new PrCandidate(
                            candidateNode.path("patch_summary").asText(),
                            patches,
                            candidateNode.path("pr_title").asText(),
                            candidateNode.path("pr_body").asText()
                    ));
                }
            }

            return new AiAnalysisResult(isConfident, summary, impact, causeDescription, prNeeded, prCandidates);

        } catch (Exception e) {
            System.err.println("Failed to parse JSON schema: " + e.getMessage());
            System.err.println("Raw response: " + rawResultJson);
            return buildErrorResult("⚠️ AI 응답 데이터의 구조화된 파싱에 실패했습니다. 에러: " + e.getMessage());
        }
    }

    private String runAgenticLoop(List<Map<String, Object>> messages, String model, Path workspace, WorkspacePort workspacePort, boolean useStructured, int maxIterations) throws Exception {
        Map<String, Integer> toolCallHistory = new HashMap<>();
        int iteration = 0;

        while (true) {
            iteration++;
            System.out.println(" -> Agentic Loop Iteration " + iteration + "/" + maxIterations);

            if (iteration > maxIterations) {
                throw new RuntimeException(
                        "[AI] Agentic loop exceeded dynamic cap of " + maxIterations +
                        " iterations (repo has ~" + workspacePort.countSourceFiles(workspace) + " source files)." +
                        " Increase DRY_RUN or review repo size thresholds."
                );
            }

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
        String jsonStr = rawText.trim();
        
        // Extract the outer-most JSON object if not already clean
        if (!(jsonStr.startsWith("{") && jsonStr.endsWith("}"))) {
            int firstBrace = jsonStr.indexOf("{");
            int lastBrace = jsonStr.lastIndexOf("}");
            if (firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
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

        Map<String, Object> prCandidates = new HashMap<>();
        prCandidates.put("type", "array");
        prCandidates.put("description", "최대 3개의 서로 다른 PR 수정 후보군 (확신도가 낮더라도 제안)");

        Map<String, Object> candidateItem = new HashMap<>();
        candidateItem.put("type", "object");

        Map<String, Object> candidateProps = new HashMap<>();
        candidateProps.put("patch_summary", Map.of("type", "string", "description", "이 후보의 수정 요약 (비개발자용)"));
        candidateProps.put("pr_title", Map.of("type", "string", "description", "이 후보 PR의 제목"));
        candidateProps.put("pr_body", Map.of("type", "string", "description", "이 후보 PR의 본문 (설명 포함)"));

        Map<String, Object> patchInstructions = new HashMap<>();
        patchInstructions.put("type", "array");

        Map<String, Object> patchItem = new HashMap<>();
        patchItem.put("type", "object");
        Map<String, Object> patchItemProps = new HashMap<>();
        patchItemProps.put("file_path", Map.of("type", "string"));
        patchItemProps.put("old_code", Map.of("type", "string"));
        patchItemProps.put("new_code", Map.of("type", "string"));
        patchItem.put("properties", patchItemProps);
        patchItem.put("required", Arrays.asList("file_path", "old_code", "new_code"));
        patchItem.put("additionalProperties", false);

        patchInstructions.put("items", patchItem);
        candidateProps.put("patch_instructions", patchInstructions);

        candidateItem.put("properties", candidateProps);
        candidateItem.put("required", Arrays.asList("patch_summary", "patch_instructions", "pr_title", "pr_body"));
        candidateItem.put("additionalProperties", false);

        prCandidates.put("items", candidateItem);
        properties.put("pr_candidates", prCandidates);

        schema.put("properties", properties);
        schema.put("required", Arrays.asList(
                "is_confident", "summary", "impact", "cause_description",
                "pr_needed", "pr_candidates"
        ));
        schema.put("additionalProperties", false);

        jsonSchema.put("schema", schema);
        resFormat.put("json_schema", jsonSchema);

        return resFormat;
    }

    private AiAnalysisResult buildErrorResult(String msg) {
        return new AiAnalysisResult(false, msg, "오류가 발생하여 분석하지 못했습니다.", "", false, Collections.emptyList());
    }
}
