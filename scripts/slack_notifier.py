import requests

def send_slack_notification(webhook_url: str, raw_log: str, ai_result: dict, event_type: str, repo: str, run_id: str = None, pr_url: str = None):
    """Sends the formatted diagnostic message payload to Slack via Incoming Webhook."""
    # Treat empty, dummy placeholders, or invalid URLs as not set
    is_invalid_webhook = (
        not webhook_url or 
        "your/webhook/url" in webhook_url or 
        not webhook_url.startswith("https://")
    )
    if is_invalid_webhook:
        print("Warning: SLACK_WEBHOOK_URL is not set or is a placeholder. Printing payload to stdout.")
        test_payload = build_slack_message(raw_log, ai_result, event_type, repo, run_id, pr_url)
        print(test_payload)
        return

    payload = {
        "text": build_slack_message(raw_log, ai_result, event_type, repo, run_id, pr_url)
    }

    try:
        res = requests.post(webhook_url, json=payload)
        if res.status_code != 200:
            print(f"Slack webhook failed: {res.status_code}, Response: {res.text}")
        else:
            print("Slack notification sent successfully.")
    except Exception as e:
        print(f"Failed to send Slack notification: {e}")

def build_slack_message(raw_log: str, ai_result: dict, event_type: str, repo: str, run_id: str = None, pr_url: str = None) -> str:
    """Assembles Slack message Markdown blocks following non-developer-friendly alignment guidelines."""
    title = f"🚨 *[{repo}] AI Error Notification*"
    if event_type == "issues":
        context = f"• *Event*: Issue Opened"
    else:
        context = f"• *Event*: Workflow Run Failed\n• *Run ID*: <https://github.com/{repo}/actions/runs/{run_id}|{run_id}>"

    summary = ai_result.get("summary", "핵심 요약 정보가 존재하지 않습니다.")
    impact = ai_result.get("impact", "영향 범위 정보가 존재하지 않습니다.")
    cause = ai_result.get("cause_description", "상세 원인 설명이 존재하지 않습니다.")

    folded_log = f"<details>\n<summary>📝 원본 에러 로그 보기</summary>\n\n```\n{raw_log}\n```\n</details>"
    
    pr_status = ""
    if pr_url:
        patch_summary = ai_result.get("patch_summary", "코드 수정을 완료했습니다.")
        pr_status = (
            f"🤖 *[AI Auto-Patch]* 원인을 감지하여 자동으로 코드를 수정하고 PR을 생성했습니다!\n"
            f"🛠️ *패치 내용*: {patch_summary}\n"
            f"👉 *PR Link*: <{pr_url}|{pr_url}>"
        )
    else:
        pr_status = "ℹ️ *[AI Auto-Patch]* 원인이 불명확하거나 코드로 해결할 수 없어 자동 PR을 생성하지 않았습니다."

    message_blocks = [
        title,
        context,
        f"*📌 핵심 요약*\n{summary}",
        f"*⚠️ 위험도 및 서비스 영향*\n{impact}",
        f"*🔍 상세 원인 및 조치 방법*\n{cause}",
        folded_log,
        pr_status
    ]

    return "\n\n".join(message_blocks)
