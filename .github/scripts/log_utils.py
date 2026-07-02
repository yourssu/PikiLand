import re
import zipfile
import io
import requests

def clean_ansi_escape_codes(text: str) -> str:
    """Removes ANSI color codes and styling sequences from logs."""
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)

def clean_progress_bars(text: str) -> str:
    """Filters out verbose progress indicator bars (e.g., pip, npm install) to preserve token space."""
    progress_bar_pattern = re.compile(r'\[[=#>-]+\s*\]\s*\d+[%/]')
    lines = text.splitlines()
    cleaned_lines = [line for line in lines if not progress_bar_pattern.search(line)]
    return "\n".join(cleaned_lines)

def truncate_log_for_ai(log_text: str, max_lines: int = 300) -> str:
    """
    Truncates build logs focusing on the Head (15%) and Tail (85%),
    while extracting lines containing error keywords from the middle section.
    """
    log_text = clean_ansi_escape_codes(log_text)
    log_text = clean_progress_bars(log_text)
    
    lines = log_text.splitlines()
    total_lines = len(lines)

    if total_lines <= max_lines:
        return log_text

    head_count = int(max_lines * 0.15)
    tail_count = max_lines - head_count

    head_lines = lines[:head_count]
    tail_lines = lines[-tail_count:]

    # Search middle section for critical errors with a surrounding context window
    middle_lines = lines[head_count:-tail_count]
    error_keywords = ["error", "exception", "failed", "fatal", "traceback"]
    extra_lines = []
    
    i = 0
    while i < len(middle_lines):
        line = middle_lines[i]
        if any(kw in line.lower() for kw in error_keywords):
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
    """Fetches build logs of a failed workflow run as a ZIP, extracts, and merges all text outputs."""
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
        for filename in sorted(z.namelist()):
            if filename.endswith(".txt") or "/" not in filename:
                with z.open(filename) as f:
                    content = f.read().decode('utf-8', errors='ignore')
                    logs_content.append(f"=== File: {filename} ===\n{content}")
                    
    return "\n\n".join(logs_content)
