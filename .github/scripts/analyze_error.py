import os
import re
import sys
import zipfile
import io
import requests
from openai import OpenAI

def load_dotenv(env_path=".env"):
    """Loads environment variables from a local .env file if it exists,
    WITHOUT overwriting already set environment variables (preserves GitHub Secrets)."""
    if os.path.exists(env_path):
        print(f"Loading environment variables from {env_path}...")
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip().upper()
                    v = v.strip().strip("'\"")
                    
                    # Map lowercase custom env keys to standardized uppercase env keys
                    target_keys = [k]
                    if k == "API_KEY":
                        target_keys.append("AI_API_KEY")
                    elif k == "SLACK_WEBHOOK_URL":
                        target_keys.append("SLACK_WEBHOOK_URL")
                    elif k == "AI_MODEL":
                        target_keys.append("AI_MODEL")
                    elif k == "BASE_URL":
                        target_keys.append("AI_BASE_URL")
                    
                    # ONLY set if the key is not already defined in the OS environment (GitHub Secrets/Vars)
                    for tk in target_keys:
                        if tk not in os.environ:
                            os.environ[tk] = v

def clean_ansi_escape_codes(text: str) -> str:
    """Removes ANSI color codes/escape sequences from build logs."""
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)

def clean_progress_bars(text: str) -> str:
    """Removes verbose progress bars (e.g., npm or pip install outputs) to save tokens."""
    progress_bar_pattern = re.compile(r'\[[=#>-]+\s*\]\s*\d+[%/]')
    lines = text.splitlines()
    cleaned_lines = [line for line in lines if not progress_bar_pattern.search(line)]
    return "\n".join(cleaned_lines)

def truncate_log_for_ai(log_text: str, max_lines: int = 300) -> str:
    """Truncates log data by focusing on Head and Tail, with keyword search for middle errors."""
    log_text = clean_ansi_escape_codes(log_text)
    log_text = clean_progress_bars(log_text)
    
    lines = log_text.splitlines()
    total_lines = len(lines)

    if total_lines <= max_lines:
        return log_text

    # Extract based on ratio (Head 15%, Tail 85%)
    head_count = int(max_lines * 0.15)
    tail_count = max_lines - head_count

    head_lines = lines[:head_count]
    tail_lines = lines[-tail_count:]

    # Middle section analysis for error keyword scan
    middle_lines = lines[head_count:-tail_count]
    error_keywords = ["error", "exception", "failed", "fatal", "traceback"]
    extra_lines = []
    
    i = 0
    while i < len(middle_lines):
        line = middle_lines[i]
        if any(kw in line.lower() for kw in error_keywords):
            # Include window of 2 lines before and after
            start = max(0, i - 2)
            end = min(len(middle_lines), i + 3)
            extra_lines.append(f"\n--- [Error Context Detected (Middle)] ---")
            extra_lines.extend(middle_lines[start:end])
            extra_lines.append(f"----------------------------------------\n")
            i = end - 1
        i += 1

    skipped_count = total_lines - max_lines
    separator = [
        f"\n... [System Alert: Truncated - {skipped_count} lines omitted] ...\n"
        "... [Normal logs omitted to fit AI context limit] ...\n"
    ]
    
    if extra_lines:
        result_lines = head_lines + separator + extra_lines + separator + tail_lines
    else:
        result_lines = head_lines + separator + tail_lines
        
    return "\n".join(result_lines)

def download_github_workflow_logs(repo: str, run_id: str, token: str) -> str:
    """Downloads workflow run logs from GitHub API as a ZIP file and merges the text files."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }
    url = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/logs"
    print(f"Downloading logs from: {url}")
    
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        raise Exception(f"Failed to download logs. Status code: {response.status_code}, Response: {response.text}")
        
    logs_content = []
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        # Merge log text files sequentially
        for filename in sorted(z.namelist()):
            # Collect text files or files at root log level
            if filename.endswith(".txt") or "/" not in filename:
                with z.open(filename) as f:
                    content = f.read().decode('utf-8', errors='ignore')
                    logs_content.append(f"=== File: {filename} ===\n{content}")
                    
    return "\n\n".join(logs_content)

def analyze_with_ai(content_to_analyze: str, event_type: str, api_key: str) -> str:
    """Calls Factchat Gateway OpenAI-compatible API to analyze error information."""
    base_url = os.environ.get("AI_BASE_URL", "https://factchat-cloud.mindlogic.ai/v1/gateway")
    model_name = os.environ.get("AI_MODEL", "gpt-5.4-mini")
    
    if not api_key:
        print("Warning: AI_API_KEY is not set. Skipping AI analysis and using raw log summary.")
        return "⚠️ **AI_API_KEY가 설정되지 않아 AI 분석을 진행하지 못했습니다.**\n\n로그 내용의 일부를 확인해 주세요."

    print(f"Connecting to AI Gateway base URL: {base_url}")
    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )
    
    system_prompt = (
        "당신은 시니어 데브옵스(DevOps) 엔지니어입니다. 제공되는 로그 또는 이슈 데이터를 분석하여 원인과 해결책을 마크다운 형식으로 요약해야 합니다.\n\n"
        "다음 형식에 맞게 출력하세요:\n"
        "1. **오류 위치**: (예: 어떤 파일, 모듈, 또는 인프라 배포 단계인지 명시)\n"
        "2. **발생 원인**: (기술적인 핵심 원인을 명확하게 설명)\n"
        "3. **영향 범위**: (해당 오류가 전체 시스템 및 사용자에게 미치는 영향 추정)\n"
        "4. **해결 방안**: (문제를 해결하기 위해 바로 조치할 수 있는 구체적인 가이드 1~2가지)\n\n"
        "주의: 로그나 데이터에서 명확한 원인을 찾기 어려울 경우 무리하게 지어내지 말고, '원인 불명 (추가 확인 필요)'이라고 표시하십시오."
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
        return response.choices[0].message.content
    except Exception as e:
        print(f"Error during AI API call: {e}")
        return f"⚠️ **AI 분석 호출 중 에러가 발생했습니다.**\n오류 내용: {str(e)}"

def send_slack_notification(webhook_url: str, raw_log: str, ai_feedback: str, event_type: str, repo: str, run_id: str = None):
    """Sends the analysis results to Slack using Incoming Webhook.
    Conforms to user format requirement: raw_log is enclosed in a details markdown block,
    followed by the uncollapsed AI feedback."""
    if not webhook_url:
        print("Warning: SLACK_WEBHOOK_URL is not set. Printing payload to stdout.")
        test_payload = build_slack_message(raw_log, ai_feedback, event_type, repo, run_id)
        print(test_payload)
        return

    payload = {
        "text": build_slack_message(raw_log, ai_feedback, event_type, repo, run_id)
    }

    try:
        res = requests.post(webhook_url, json=payload)
        if res.status_code != 200:
            print(f"Slack webhook failed: {res.status_code}, Response: {res.text}")
        else:
            print("Slack notification sent successfully.")
    except Exception as e:
        print(f"Failed to send Slack notification: {e}")

def build_slack_message(raw_log: str, ai_feedback: str, event_type: str, repo: str, run_id: str = None) -> str:
    """Helper to build Slack message payload with markdown folding."""
    title = f"🚨 *[{repo}] AI Error Notification*"
    if event_type == "issues":
        context = f"• *Event*: Issue Opened"
    else:
        context = f"• *Event*: Workflow Run Failed\n• *Run ID*: <https://github.com/{repo}/actions/runs/{run_id}|{run_id}>"

    # Markdown folding details syntax
    folded_log = f"<details>\n<summary>📝 에러 로그 보기</summary>\n\n```\n{raw_log}\n```\n</details>"
    
    return f"{title}\n{context}\n\n{folded_log}\n\n### 🤖 AI 오류 분석 피드백\n{ai_feedback}"

def main():
    # Load .env variables manually to bypass dependency requirements
    # Will only set variable keys NOT already present in OS environment variables (GitHub Secrets/Vars)
    load_dotenv()
    
    event_name = os.environ.get("EVENT_NAME", "workflow_run")
    repo = os.environ.get("GITHUB_REPOSITORY", "unknown/repo")
    token = os.environ.get("GITHUB_TOKEN", "")
    run_id = os.environ.get("RUN_ID", "")
    issue_body = os.environ.get("ISSUE_BODY", "")
    ai_api_key = os.environ.get("AI_API_KEY", "")
    slack_webhook_url = os.environ.get("SLACK_WEBHOOK_URL", "")

    content_to_analyze = ""
    
    if event_name == "issues":
        print("Processing Issue Event...")
        content_to_analyze = issue_body if issue_body else "No issue body content provided."
    elif event_name == "workflow_run":
        print(f"Processing Workflow Run Event for Run ID: {run_id}...")
        # Local testing fallbacks if run_id / token is not present
        if not run_id or not token:
            print("Warning: RUN_ID or GITHUB_TOKEN is missing. Using dummy Gradle error logs for local test.")
            dummy_gradle_log = (
                "Starting a Gradle Daemon, 1 incompatible Daemon could not be reused, use --status for details\n"
                "Configuring projects...\n"
                "Analyzing dependencies...\n"
                "[:compileJava] Compiling 15 source files...\n"
                "[:processResources] Copying resources...\n"
                "[:classes] Classes generated.\n"
                "[:compileTestJava] Compiling 2 test source files...\n"
                "/Users/yoon/pikiland/src/test/java/com/example/demo/DemoApplicationTests.java:12: error: cannot find symbol\n"
                "        User user = new User(\"test\", \"test@example.com\");\n"
                "        ^\n"
                "  symbol:   class User\n"
                "  location: class DemoApplicationTests\n"
                "/Users/yoon/pikiland/src/test/java/com/example/demo/DemoApplicationTests.java:12: error: cannot find symbol\n"
                "        User user = new User(\"test\", \"test@example.com\");\n"
                "                        ^\n"
                "  symbol:   class User\n"
                "  location: class DemoApplicationTests\n"
                "2 errors\n\n"
                "FAILURE: Build failed with an exception.\n\n"
                "* What went wrong:\n"
                "Execution failed for task ':compileTestJava'.\n"
                "> Compilation failed; see the compiler error output for details.\n\n"
                "* Try:\n"
                "Run with --stacktrace option to get the stack trace. Run with --info or --debug option to get more log output. Run with --scan to get full insights.\n\n"
                "* Get more help at https://help.gradle.org\n\n"
                "BUILD FAILED in 2s\n"
                "4 actionable tasks: 3 executed, 1 failed\n"
            )
            content_to_analyze = truncate_log_for_ai(dummy_gradle_log)
        else:
            try:
                raw_logs = download_github_workflow_logs(repo, run_id, token)
                content_to_analyze = truncate_log_for_ai(raw_logs)
            except Exception as e:
                content_to_analyze = f"Failed to download/parse workflow logs: {str(e)}"
                print(content_to_analyze)
    else:
        print(f"Unsupported event: {event_name}")
        sys.exit(0)

    # Perform AI analysis
    print("Calling AI API for analysis...")
    analysis_result = analyze_with_ai(content_to_analyze, event_name, ai_api_key)
    
    # Send Slack notification
    send_slack_notification(
        webhook_url=slack_webhook_url,
        raw_log=content_to_analyze,
        ai_feedback=analysis_result,
        event_type=event_name,
        repo=repo,
        run_id=run_id
    )

if __name__ == "__main__":
    main()
