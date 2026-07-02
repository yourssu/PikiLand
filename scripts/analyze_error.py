import os
import sys

# Add current scripts directory to Python path to ensure module importing works in GitHub Action environments
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Automatically detect and install missing requirements to run completely unattended
required_deps = ["requests", "openai"]
missing_deps = []
for dep in required_deps:
    try:
        __import__(dep)
    except ImportError:
        missing_deps.append(dep)

if missing_deps:
    print(f"Missing required packages: {missing_deps}. Installing automatically...", flush=True)
    try:
        cmd = [sys.executable, "-m", "pip", "install"] + missing_deps
        try:
            # Try standard install first (works in venv and default environments)
            subprocess.check_call(cmd)
        except subprocess.CalledProcessError:
            # Fallback for externally managed environments (PEP 668)
            print("Standard install blocked. Retrying with system override flag...", flush=True)
            subprocess.check_call(cmd + ["--break-system-packages"])
        print("Required packages installed successfully.", flush=True)
    except Exception as e:
        print(f"Fatal Error: Failed to auto-install dependencies: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

from env_config import load_dotenv
from log_utils import truncate_log_for_ai, download_github_workflow_logs
from ai_client import analyze_with_ai
from git_utils import create_auto_patch_pr
from slack_notifier import send_slack_notification

def main():
    # 1. Initialize environment settings
    load_dotenv()
    
    event_name = os.environ.get("EVENT_NAME", "workflow_run")
    repo = os.environ.get("GITHUB_REPOSITORY", "unknown/repo")
    token = os.environ.get("GITHUB_TOKEN", "")
    run_id = os.environ.get("RUN_ID", "")
    issue_body = os.environ.get("ISSUE_BODY", "")
    ai_api_key = os.environ.get("AI_API_KEY", "")
    slack_webhook_url = os.environ.get("SLACK_WEBHOOK_URL", "")

    content_to_analyze = ""
    
    # 2. Extract and sanitize raw logs/issues text
    if event_name == "issues":
        print("Processing Issue Event...")
        content_to_analyze = issue_body if issue_body else "No issue body content provided."
    elif event_name == "workflow_run":
        print(f"Processing Workflow Run Event for Run ID: {run_id}...")
        if not run_id or not token:
            print("Warning: RUN_ID or GITHUB_TOKEN is missing. Using dummy Gradle error logs for local test.")
            dummy_gradle_log = (
                "[:compileJava] Compiling 15 source files...\n"
                "/Users/yoon/pikiland/src/test/java/com/example/demo/DemoApplicationTests.java:12: error: cannot find symbol\n"
                "        User user = new User(\"test\", \"test@example.com\");\n"
                "        ^\n"
                "  symbol:   class User\n"
                "  location: class DemoApplicationTests\n"
                "BUILD FAILED in 2s\n"
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

    # 3. Query OpenAI-compatible API to get structural review
    print("Calling AI API for analysis...")
    ai_result = analyze_with_ai(content_to_analyze, event_name, ai_api_key)
    
    is_confident = ai_result.get("is_confident", False)
    explanation = ai_result.get("explanation", "No explanation provided.")
    pr_needed = ai_result.get("pr_needed", False)
    patch_instructions = ai_result.get("patch_instructions", [])
    pr_title = ai_result.get("pr_title", "")
    pr_body = ai_result.get("pr_body", "")

    # 4. Trigger auto-patching and git PR submission if confidence checks pass
    pr_url = None
    if is_confident and pr_needed and patch_instructions:
        print("AI is confident and requested code patching. Triggering auto-patch PR creation...")
        pr_url = create_auto_patch_pr(
            patch_instructions=patch_instructions,
            pr_title=pr_title,
            pr_body=pr_body,
            repo=repo,
            run_id=run_id,
            event_name=event_name
        )
    else:
        print("Skipping auto-patch: AI is not confident or no patch instructions were provided.")

    # 5. Broadcast to Slack
    send_slack_notification(
        webhook_url=slack_webhook_url,
        raw_log=content_to_analyze,
        ai_feedback=explanation,
        event_type=event_name,
        repo=repo,
        run_id=run_id,
        pr_url=pr_url
    )

if __name__ == "__main__":
    main()
