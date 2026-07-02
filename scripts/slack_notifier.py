import requests

def send_slack_notification(webhook_url: str, raw_log: str, ai_feedback: str, event_type: str, repo: str, run_id: str = None, pr_url: str = None):
    """Sends the formatted diagnostic message payload to Slack via Incoming Webhook."""
    if not webhook_url:
        print("Warning: SLACK_WEBHOOK_URL is not set. Printing payload to stdout.")
        test_payload = build_slack_message(raw_log, ai_feedback, event_type, repo, run_id, pr_url)
        print(test_payload)
        return

    payload = {
        "text": build_slack_message(raw_log, ai_feedback, event_type, repo, run_id, pr_url)
    }

    try:
        res = requests.post(webhook_url, json=payload)
        if res.status_code != 200:
            print(f"Slack webhook failed: {res.status_code}, Response: {res.text}")
        else:
            print("Slack notification sent successfully.")
    except Exception as e:
        print(f"Failed to send Slack notification: {e}")

def build_slack_message(raw_log: str, ai_feedback: str, event_type: str, repo: str, run_id: str = None, pr_url: str = None) -> str:
    """Assembles Slack message Markdown blocks, wrapping the raw log inside adetails tag."""
    title = f"🚨 *[{repo}] AI Error Notification*"
    if event_type == "issues":
        context = f"• *Event*: Issue Opened"
    else:
        context = f"• *Event*: Workflow Run Failed\n• *Run ID*: <https://github.com/{repo}/actions/runs/{run_id}|{run_id}>"

    folded_log = f"<details>\n<summary>📝 에러 로그 보기</summary>\n\n```\n{raw_log}\n```\n</details>"
    
    pr_status = ""
    if pr_url:
        pr_status = f"\n\n🤖 *[AI Auto-Patch]* 원인을 감지하여 자동으로 코드를 수정하고 PR을 생성했습니다!\n👉 *PR Link*: <{pr_url}|{pr_url}>"
    else:
        pr_status = "\n\nℹ️ *[AI Auto-Patch]* 원인이 불명확하거나 코드로 해결할 수 없어 자동 PR을 생성하지 않았습니다."

    return f"{title}\n{context}\n\n{folded_log}\n\n### 🤖 AI 오류 분석 피드백\n{ai_feedback}{pr_status}"
