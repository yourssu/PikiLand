import re
import zipfile
import io
import requests

def clean_ansi_escape_codes(text: str) -> str:
    """Removes ANSI color codes and styling sequences from logs."""
    ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', text)

def clean_progress_bars(text: str) -> str:
    """
    Replaces verbose progress indicator bars with a short placeholder 
    instead of dropping the entire line to prevent losing inline error messages.
    """
    progress_bar_pattern = re.compile(r'\[[=#>-]+\s*\]\s*\d+[%/]')
    # 줄을 삭제하지 않고 정규식에 해당하는 진행 바 텍스트만 [PROGRESS]로 치환합니다.
    return progress_bar_pattern.sub('[PROGRESS]', text)

def truncate_log_for_ai(log_text: str, max_lines: int = 300) -> str:
    """
    Truncates build logs focusing on the Head (15%) and Tail (85%).
    Uses interval merging to safely extract error contexts from the middle section.
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

    middle_lines = lines[head_count:-tail_count]
    # 탐지 키워드 대폭 확장 (시스템 및 빌드 에러 포함)
    error_keywords = [
        "error", "exception", "failed", "fatal", "traceback",
        "segfault", "panic", "killed", "timeout", "abort", "syntax", "denied"
    ]
    
    # 키워드가 포함된 줄의 인덱스를 모두 찾음
    error_indices = [
        idx for idx, line in enumerate(middle_lines) 
        if any(kw in line.lower() for kw in error_keywords)
    ]
    
    # 겹치는 구간을 병합(Merge)하여 문맥 파편화 방지 (앞뒤 5줄씩 보존)
    context_size = 5
    intervals = []
    for idx in error_indices:
        start = max(0, idx - context_size)
        end = min(len(middle_lines), idx + context_size + 1)
        
        if not intervals:
            intervals.append([start, end])
        else:
            last_start, last_end = intervals[-1]
            if start <= last_end:
                intervals[-1][1] = max(last_end, end)
            else:
                intervals.append([start, end])

    extra_lines = []
    for start, end in intervals:
        extra_lines.append("\n--- [Error Context Detected (Middle)] ---")
        extra_lines.extend(middle_lines[start:end])
        extra_lines.append("----------------------------------------\n")

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