import os
import re
import json
from openai import OpenAI
from code_retriever import execute_list_directory, execute_read_file_content, execute_grep_in_file

def parse_bool(val) -> bool:
    """Helper to convert string/boolean values to pure boolean."""
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes")
    return bool(val)

def sanitize_json_string(raw_text: str) -> str:
    """
    Extracts the JSON payload from potential markdown wrappers and
    sanitizes comments, trailing commas, and encoding issues.
    """
    # 1. Extract markdown json blocks or raw braces
    json_str = ""
    markdown_match = re.search(r'```(?:json)?\s*(.*?)\s*```', raw_text, re.DOTALL | re.IGNORECASE)
    if markdown_match:
        json_str = markdown_match.group(1)
    else:
        first_brace = raw_text.find('{')
        last_brace = raw_text.rfind('}')
        if first_brace != -1 and last_brace != -1:
            json_str = raw_text[first_brace:last_brace+1]
        else:
            json_str = raw_text.strip()

    # 2. Strip multiline C-style comments
    json_str = re.sub(r'\/\*.*?\*\/', '', json_str, flags=re.DOTALL)
    
    # 3. Strip single-line comments while preserving URLs (http://, https://)
    cleaned_lines = []
    for line in json_str.splitlines():
        # Strip comments not preceded by 'http:', 'https:' or ':'
        cleaned_line = re.sub(r'(?<!https)(?<!http)(?<!:)\/\/.*$', '', line)
        cleaned_lines.append(cleaned_line)
    json_str = "\n".join(cleaned_lines)

    # 4. Remove trailing commas (comma followed by closing bracket/brace)
    json_str = re.sub(r',\s*([\]}])', r'\1', json_str)

    return json_str.strip()

def validate_and_default_schema(data: dict) -> dict:
    """Validates types and returns a guaranteed dictionary schema."""
    if not isinstance(data, dict):
        raise ValueError("Decoded JSON is not a dictionary.")

    # Cast patch_instructions
    raw_patches = data.get("patch_instructions", [])
    patches = []
    if isinstance(raw_patches, list):
        for item in raw_patches:
            if isinstance(item, dict):
                patches.append({
                    "file_path": str(item.get("file_path", "")),
                    "old_code": str(item.get("old_code", "")),
                    "new_code": str(item.get("new_code", ""))
                })

    safe_data = {
        "is_confident": parse_bool(data.get("is_confident", False)),
        "summary": str(data.get("summary", "")),
        "impact": str(data.get("impact", "")),
        "cause_description": str(data.get("cause_description", "")),
        "pr_needed": parse_bool(data.get("pr_needed", False)),
        "patch_summary": str(data.get("patch_summary", "")),
        "patch_instructions": patches,
        "pr_title": str(data.get("pr_title", "")),
        "pr_body": str(data.get("pr_body", ""))
    }
    return safe_data

def analyze_with_ai(content_to_analyze: str, event_type: str, api_key: str) -> dict:
    """
    Connects to the specified OpenAI-compatible gateway and queries the model
    to perform error diagnostics. Enforces structured JSON via Structured Outputs
    with a robust 2-step fallback logic, equipped with local workspace search tools.
    """
    base_url = os.environ.get("AI_BASE_URL", "").strip()
    model_name = os.environ.get("AI_MODEL", "").strip()
    api_key = api_key.strip() if api_key else ""
    
    default_error_response = {
        "is_confident": False,
        "summary": "⚠️ AI 분석 호출 또는 데이터 파싱에 실패했습니다.",
        "impact": "오류 파싱 중 문제 발생으로 영향 범위를 판단할 수 없습니다.",
        "cause_description": "",
        "pr_needed": False,
        "patch_summary": "",
        "patch_instructions": [],
        "pr_title": "",
        "pr_body": ""
    }

    if not api_key:
        print("Warning: AI_API_KEY is not set. Skipping AI analysis.")
        res = default_error_response.copy()
        res["summary"] = "⚠️ AI_API_KEY가 설정되지 않았습니다."
        res["impact"] = "인증 키가 없어 영향 범위를 분석하지 못했습니다."
        return res

    if not base_url:
        print("Warning: AI_BASE_URL is not set. Skipping AI analysis.")
        res = default_error_response.copy()
        res["summary"] = "⚠️ AI_BASE_URL이 설정되지 않았습니다."
        res["impact"] = "Gateway 경로가 지정되지 않아 영향 범위를 분석하지 못했습니다."
        return res

    if not model_name:
        print("Warning: AI_MODEL is not set. Skipping AI analysis.")
        res = default_error_response.copy()
        res["summary"] = "⚠️ AI_MODEL이 설정되지 않았습니다."
        res["impact"] = "분석 모델이 지정되지 않아 영향 범위를 분석하지 못했습니다."
        return res

    print(f"Connecting to AI Gateway base URL: {base_url}")
    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )
    
    system_prompt = (
        "당신은 시니어 데브옵스(DevOps) 엔지니어이자 풀스택 소프트웨어 엔지니어입니다. 제공되는 로그 또는 이슈 데이터를 분석하여, 에러의 해결 방안과 자동 패치 여부를 결정해야 합니다.\n\n"
        "당신은 오류의 맥락을 정확히 이해하기 위해 프로젝트 워크스페이스의 디렉토리와 파일을 탐색할 수 있는 도구(Tools)를 사용할 수 있습니다.\n"
        "모든 분석이 완료되면 반드시 정의된 JSON 스키마를 엄격히 준수하여 응답해야 합니다.\n"
        "특히 'summary'와 'impact' 항목은 비개발자(기획자, PM, 운영팀 등)가 즉시 이해할 수 있도록 전문적인 IT 용어를 배제하거나 풀어서 설명하고 극도로 객관적으로 작성해 주십시오.\n"
        "또한 'patch_summary' 항목은 자동 패치(PR)가 생성될 시(pr_needed가 true인 경우) 무엇을 어떻게 고쳤는지 비개발자가 이해할 수 있도록 쉬운 설명글로 설명해 주십시오. 만약 패치가 필요 없거나 생성하지 않을 경우 빈 문자열(\"\")로 작성해 주십시오.\n\n"
        "⚠️ [중요 - 코드 자동 패치 생성 시 엄격한 근본 치료 규칙]\n"
        "1. **임시 땜질식(Dummy/Workaround) 대처 금지**: 단순히 에러 메시지만 안 나타나게 덮기 위해, 선언되지 않은 객체를 엉뚱한 임시 문자열(\"test\")이나 Null 혹은 스터브(stub) 값으로 성급하게 치환하는 행위를 엄격히 금지합니다.\n"
        "2. **근본적이고 안전한 수정**: 클래스나 라이브러리 임포트 누락의 경우, 실제 해당 클래스를 올바르게 임포트하거나 의존성을 매핑해야 합니다. 코드의 제어 흐름에 예외가 발생한다면, 단순히 코드를 지우거나 빈 값으로 덮지 말고 정확한 Null 가드 조건이나 안전한 경계값 처리를 추가하여 로직을 온전하게 작동시켜야 합니다.\n"
        "3. **연쇄 영향 파악**: 수정하는 코드가 프로젝트 전체의 연관 비즈니스 흐름이나 다른 파일에 연쇄적인 논리적 장애(Side Effect)를 일으키지 않을지 신중히 분석하십시오.\n"
        "4. **해결책의 불명확성 인지**: 로그나 정보가 부족하여 완전하고 근본적인 해결 코드를 작성할 수 없거나, 소스 코드 수정만으로는 불가능한 환경/인프라성 장애인 경우, 절대로 `is_confident` 및 `pr_needed`를 true로 지정하지 말고 false로 둔 채 상세 진단만 제공하십시오. 100% 확실하고 부작용 없는 안전한 근본 코드 수정만 PR로 이어져야 합니다."
    )
    
    user_prompt = f"이벤트 유형: {event_type}\n\n[분석할 데이터]\n{content_to_analyze}"
    
    # Define response schema for Structured Outputs
    response_schema = {
        "type": "json_schema",
        "json_schema": {
            "name": "error_analysis",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "is_confident": {"type": "boolean"},
                    "summary": {
                        "type": "string",
                        "description": "에러 상황에 대한 1줄 핵심 요약. 비개발자도 즉시 상황을 파악할 수 있도록 전문 용어를 배제하고 설명해 주세요."
                    },
                    "impact": {
                        "type": "string",
                        "description": "장애 위험도 및 서비스 영향 범위. 비개발 언어로 현재 어떤 기능이 차단되거나 먹통이 되었는지, 아니면 단순 경고인지 상황을 설명해 주세요."
                    },
                    "cause_description": {
                        "type": "string",
                        "description": "기술적인 에러 원인 및 구체적인 조치 방법 가이드 (개발자용 마크다운 형식)."
                    },
                    "pr_needed": {"type": "boolean"},
                    "patch_summary": {
                        "type": "string",
                        "description": "자동 패치(PR)가 생성될 시 무엇을 어떻게 고쳤는지 비개발자가 이해하기 쉽게 요약한 한 줄 설명. 패치를 생성하지 않는다면 빈 문자열(\"\")로 지정해 주세요."
                    },
                    "patch_instructions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "file_path": {"type": "string"},
                                "old_code": {"type": "string"},
                                "new_code": {"type": "string"}
                            },
                            "required": ["file_path", "old_code", "new_code"],
                            "additionalProperties": False
                        }
                    },
                    "pr_title": {"type": "string"},
                    "pr_body": {"type": "string"}
                },
                "required": [
                    "is_confident", "summary", "impact", "cause_description",
                    "pr_needed", "patch_summary", "patch_instructions", "pr_title", "pr_body"
                ],
                "additionalProperties": False
            }
        }
    }

    # Define tools for AI workspace navigation
    tools = [
        {
            "type": "function",
            "function": {
                "name": "list_directory",
                "description": "Lists subdirectories and files in a single-level folder path inside the project workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "directory_path": {
                            "type": "string",
                            "description": "Relative directory path from project root (e.g. '.', 'src', 'src/main/java'). Defaults to '.'."
                        }
                    }
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file_content",
                "description": "Reads the source code content of a specific file in the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Relative file path from project root (e.g. 'src/test/java/DemoApplicationTests.java')."
                        }
                    },
                    "required": ["file_path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "grep_in_file",
                "description": "Searches for a specific query or symbol inside a single file to locate reference details without full-project scanning overhead.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_path": {
                            "type": "string",
                            "description": "Relative file path from project root."
                        },
                        "query": {
                            "type": "string",
                            "description": "The exact term or symbol to search for (e.g. 'User')."
                        }
                    },
                    "required": ["file_path", "query"]
                }
            }
        }
    ]

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    def run_completion_with_loop(current_messages: list, use_structured_format=True) -> str:
        """Executes API completion requests, handling tool execution loop dynamically using while True."""
        tool_call_history = {} # { "func_name:arguments": count }
        iteration = 0
        
        while True:
            iteration += 1
            print(f"Agentic loop iteration {iteration}...")
            
            call_params = {
                "model": model_name,
                "messages": current_messages,
                "tools": tools,
                "temperature": 0.2
            }
            if use_structured_format:
                call_params["response_format"] = response_schema
                
            response = client.chat.completions.create(**call_params)
            response_message = response.choices[0].message
            
            # Check if LLM requested tool executions
            if response_message.tool_calls:
                # Add assistant message containing the tool calls request to conversation history
                current_messages.append(response_message)
                
                for tool_call in response_message.tool_calls:
                    func_name = tool_call.function.name
                    func_args = tool_call.function.arguments # json string
                    
                    # Stuck Loop Guard: detect duplicate identical tool calls (Limit to 5)
                    call_key = f"{func_name}:{func_args}"
                    tool_call_history[call_key] = tool_call_history.get(call_key, 0) + 1
                    
                    if tool_call_history[call_key] >= 5:
                        raise RuntimeError(f"Infinite loop detected: tool '{func_name}' was repeatedly called 5 times with arguments: {func_args}")
                    
                    print(f"-> LLM requested tool '{func_name}' with arguments: {func_args}")
                    
                    # Execute tool locally
                    args_dict = json.loads(func_args)
                    result = ""
                    if func_name == "list_directory":
                        result = execute_list_directory(args_dict.get("directory_path", "."))
                    elif func_name == "read_file_content":
                        result = execute_read_file_content(args_dict.get("file_path", ""))
                    elif func_name == "grep_in_file":
                        result = execute_grep_in_file(args_dict.get("file_path", ""), args_dict.get("query", ""))
                    else:
                        result = f"Error: Tool '{func_name}' is not recognized."
                        
                    # Add tool execution result back into conversation history
                    current_messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": func_name,
                        "content": result
                    })
            else:
                # No more tool calls; we received the final completion response
                return response_message.content

    resp_text = ""
    success = False

    # Keep a single conversational context across retries
    active_messages = messages.copy()

    # Step 1: Attempt API call with Structured Outputs (json_schema) & Tools (up to 3 retries)
    for attempt in range(1, 4):
        try:
            if os.environ.get("FORCE_FALLBACK", "false").lower() == "true":
                raise Exception("FORCE_FALLBACK is active. Simulating Structured Outputs failure.")
            print(f"Attempting Structured Outputs using model: {model_name} (Try {attempt}/3)")
            # Passing active_messages directly so it preserves collected tools and codes
            resp_text = run_completion_with_loop(active_messages, use_structured_format=True)
            print("Successfully received Structured Output response.")
            success = True
            break
        except Exception as e:
            print(f"Structured attempt {attempt}/3 failed or loop detected: {e}")
            if attempt < 3:
                print("Retrying structured generation (preserving context)...")
            else:
                print("All 3 Structured Output attempts failed.")

    # Step 2: Fallback API call without response_format constraints (up to 3 retries)
    if not success:
        print("Falling back to standard text completion request...")
        
        # Modify system prompt slightly to remind model to format raw JSON manually (overwrite first message)
        fallback_system_prompt = system_prompt + "\n반드시 다음 구조의 JSON 형식으로만 응답해 주십시오. (마크다운 ```json ... ``` 블록으로 감싸서 출력하세요)."
        active_messages[0]["content"] = fallback_system_prompt
        
        for attempt in range(1, 4):
            try:
                print(f"Attempting Fallback Text Completion (Try {attempt}/3)")
                resp_text = run_completion_with_loop(active_messages, use_structured_format=False)
                success = True
                break
            except Exception as fe:
                print(f"Fallback attempt {attempt}/3 failed or loop detected: {fe}")
                if attempt < 3:
                    print("Retrying fallback generation (preserving context)...")
                else:
                    print("All 3 Fallback attempts failed.")
                    res = default_error_response.copy()
                    res["summary"] = "⚠️ AI 분석 호출 중 에러가 발생했습니다."
                    res["impact"] = f"오류 발생: {str(fe)}"
                    return res

    # 3. Parse and sanitize the response
    try:
        sanitized_json = sanitize_json_string(resp_text)
        parsed_data = json.loads(sanitized_json)
        return validate_and_default_schema(parsed_data)
    except Exception as parse_err:
        print(f"Error during JSON sanitization or schema validation: {parse_err}")
        print(f"Failed raw response was: \n{resp_text}\n")
        res = default_error_response.copy()
        res["summary"] = "⚠️ AI 응답 데이터의 구조화된 파싱에 실패했습니다."
        res["impact"] = f"오류 내용: {str(parse_err)}"
        return res
