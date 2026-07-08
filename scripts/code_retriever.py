import os

RESTRICTED_DIRS = {'.git', '.venv', 'node_modules', 'build', 'dist', 'target', 'out', '.idea', '.vscode'}
RESTRICTED_FILES = {'.env', 'secrets.json', 'credentials'}

def execute_list_directory(directory_path=".") -> str:
    """Lists subdirectories and files in a single-level folder path inside workspace."""
    if not directory_path:
        directory_path = "."
        
    base_dir = os.path.abspath(os.getcwd())
    target_dir = os.path.abspath(os.path.join(base_dir, directory_path))
    
    # Security: check if path is within workspace
    if not target_dir.startswith(base_dir):
        return "Access Denied: Path is outside the project workspace."
        
    dir_name = os.path.basename(target_dir)
    if dir_name in RESTRICTED_DIRS:
        return "Access Denied: Restricted directory."

    if not os.path.exists(target_dir):
        return f"Directory not found: {directory_path}"
        
    if not os.path.isdir(target_dir):
        return f"Not a directory: {directory_path}"

    try:
        subdirs = []
        files = []
        for item in sorted(os.listdir(target_dir)):
            item_path = os.path.join(target_dir, item)
            if item in RESTRICTED_DIRS or item in RESTRICTED_FILES:
                continue
            if os.path.isdir(item_path):
                subdirs.append(item)
            else:
                files.append(item)
                
        result = f"[Directory: {directory_path}]\n"
        result += f"- Subdirectories: {', '.join(subdirs) if subdirs else '(None)'}\n"
        result += f"- Files: {', '.join(files) if files else '(None)'}"
        return result
    except Exception as e:
        return f"Error reading directory: {str(e)}"

def execute_read_file_content(file_path: str, max_lines: int = 300) -> str:
    """Reads the source code content of a specific file inside workspace."""
    if not file_path:
        return "Error: file_path is required."

    base_dir = os.path.abspath(os.getcwd())
    target_file = os.path.abspath(os.path.join(base_dir, file_path))
    
    # Security: check if path is within workspace
    if not target_file.startswith(base_dir):
        return "Access Denied: Path is outside the project workspace."
        
    # Check restrictions
    file_name = os.path.basename(target_file)
    if file_name in RESTRICTED_FILES or any(part in RESTRICTED_DIRS for part in file_path.split(os.sep)):
        return "Access Denied: Restricted file or directory."

    if not os.path.exists(target_file):
        return f"File not found: {file_path}"
        
    if not os.path.isfile(target_file):
        return f"Not a file: {file_path}"

    try:
        with open(target_file, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            
        total_lines = len(lines)
        if total_lines > max_lines:
            truncated_content = "".join(lines[:max_lines])
            return f"{truncated_content}\n... [Content Truncated - File has {total_lines} lines total, showing first {max_lines}] ..."
        return "".join(lines)
    except Exception as e:
        return f"Error reading file: {str(e)}"

def execute_grep_in_file(file_path: str, query: str) -> str:
    """Searches for a specific query or symbol inside a single file."""
    if not file_path or not query:
        return "Error: file_path and query are required."

    base_dir = os.path.abspath(os.getcwd())
    target_file = os.path.abspath(os.path.join(base_dir, file_path))
    
    # Security: check if path is within workspace
    if not target_file.startswith(base_dir):
        return "Access Denied: Path is outside the project workspace."

    file_name = os.path.basename(target_file)
    if file_name in RESTRICTED_FILES or any(part in RESTRICTED_DIRS for part in file_path.split(os.sep)):
        return "Access Denied: Restricted file or directory."

    if not os.path.exists(target_file):
        return f"File not found: {file_path}"

    try:
        matches = []
        with open(target_file, "r", encoding="utf-8", errors="ignore") as f:
            for idx, line in enumerate(f, 1):
                if query.lower() in line.lower():
                    matches.append(f"[Line {idx}]: {line.strip()}")
                    if len(matches) >= 50: # Cap result size
                        matches.append("... [Matches capped at 50 results] ...")
                        break
        if not matches:
            return f"No matches found for '{query}' inside {file_path}."
        return f"[Matches in {file_path} for '{query}']:\n" + "\n".join(matches)
    except Exception as e:
        return f"Error searching file: {str(e)}"
