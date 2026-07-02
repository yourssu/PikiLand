import os
import re
import json
from openai import OpenAI

def analyze_with_ai(content_to_analyze: str, event_type: str, api_key: str) -> dict:
    """
    Connects to the specified OpenAI-compatible gateway and queries the model
    to perform error diagnostics, returning structured JSON response.
    """
    base_url = os.environ.get("AI_BASE_URL", "").strip()
    model_name = os.environ.get("AI_MODEL", "").strip()
    api_key = api_key.strip() if api_key else ""
    
    if not api_key:
        print("Warning: AI_API_KEY is not set. Skipping AI analysis.")
        return {
            "is_confident": False,
            "explanation": "⚠️ **AI_API_KEY가 설정되지 않아 AI 분석을 진행하지 못했습니다.**",
            "pr_needed": False,
            "patch_instructions": [],
            "pr_title": "",
            "pr_body": ""
        }

    if not base_url:
        print("Warning: AI_BASE_URL is not set. Skipping AI analysis.")
        return {
            "is_confident": False,
            "explanation": "⚠️ **AI_BASE_URL이 설정되지 않아 AI 분석을 진행하지 못했습니다.**",
            "pr_needed": False,
            "patch_instructions": [],
            "pr_title": "",
            "pr_body": ""
        }

    if not model_name:
        print("Warning: AI_MODEL is not set. Skipping AI analysis.")
        return {
            "is_confident": False,
            "explanation": "⚠️ **AI_MODEL이 설정되지 않아 AI 분석을 진행하지 못했습니다.**",
            "pr_needed": False,
            "patch_instructions": [],
            "pr_title": "",
            "pr_body": ""
        }

    print(f"Connecting to AI Gateway base URL: {base_url}")
    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )
    
    system_prompt = (
        "당신은 시니어 데브옵스(DevOps) 엔지니어이자 풀스택 소프트웨어 엔지니어입니다. 제공되는 로그 또는 이슈 데이터를 분석하여, 에러의 해결 방안과 자동 패치 여부를 결정해야 합니다.\n\n"
        "반드시 다음 구조의 JSON 형식으로만 응답해 주십시오. (마크다운 ```json ... ``` 블록으로 감싸서 출력하세요):\n"
        "{\n"
        "  \"is_confident\": true/false, // 에러의 발생 원인과 해결 코드가 100% 확실한 경우에만 true로 설정합니다. 조금이라도 애매하거나 원인을 명확히 짚을 수 없다면 false로 설정해야 합니다.\n"
        "  \"explanation\": \"에러 분석 피드백 마크다운 텍스트. (오류 위치, 발생 원인, 영향 범위, 해결 방안 설명 포함)\",\n"
        "  \"pr_needed\": true/false, // is_confident가 true이며, 코드를 수정하여 해결할 수 있는 경우 true로 설정합니다. 인프라 설정 오류나 외부 API 다운 등 코드로 해결할 수 없는 경우는 false로 설정합니다.\n"
        "  \"patch_instructions\": [\n"
        "    {\n"
        "      \"file_path\": \"수정할 파일의 상대 경로 (예: src/index.ts)\",\n"
        "      \"old_code\": \"수정 대상이 되는 기존 코드 줄(들). 공백과 인덴테이션을 포함하여 정확히 일치해야 합니다.\",\n"
        "      \"new_code\": \"수정하여 적용할 새로운 코드 줄(들).\"\n"
        "    }\n"
        "  ],\n"
        "  \"pr_title\": \"[PikiLand AI Fix] 에러 수정 요약 제목\",\n"
        "  \"pr_body\": \"### 🤖 AI Auto Patch PR\\n\\n1. **수정한 오류**:\\n- (어떤 오류를 수정했는지 구체적으로 기재)\\n\\n2. **수정 부분**:\\n- (수정된 파일 및 코드 핵심 내용 기재)\\n\\n3. **예상 결과**:\\n- (수정 후 기대되는 동작 및 테스트 성공 여부 기재)\"\n"
        "}"
    )
    
    user_prompt = f"이벤트 유형: {event_type}\n\n[분석할 데이터]\n{content_to_analyze}"
    
    try:
        print(f"Requesting analysis using model: {model_name}")
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.2
        )
        resp_text = response.choices[0].message.content
        
        # Extract markdown json blocks
        match = re.search(r'```json\s*(.*?)\s*```', resp_text, re.DOTALL)
        if match:
            json_str = match.group(1)
        else:
            json_str = resp_text.strip()
            
        return json.loads(json_str)
    except Exception as e:
        print(f"Error during AI API call or parsing: {e}")
        return {
            "is_confident": False,
            "explanation": f"⚠️ **AI 분석 호출 또는 파싱 중 에러가 발생했습니다.**\n오류 내용: {str(e)}",
            "pr_needed": False,
            "patch_instructions": [],
            "pr_title": "",
            "pr_body": ""
        }
