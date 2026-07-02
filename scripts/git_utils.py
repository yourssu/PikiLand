import os
import subprocess
import time

def create_auto_patch_pr(patch_instructions: list, pr_title: str, pr_body: str, repo: str, run_id: str, event_name: str) -> str:
    """
    Applies patch instructions locally, commits the change, pushes to a unique branch,
    and runs GitHub CLI (gh) command to automatically submit a Pull Request.
    Supports DRY_RUN mode to simulate modifications without touching filesystem or git.
    """
    if not patch_instructions:
        print("No patch instructions provided. Skipping PR.")
        return ""

    # Check for DRY_RUN environment variable
    dry_run = os.environ.get("DRY_RUN", "false").lower() == "true"
    if dry_run:
        print("[DRY_RUN] Active. Simulating file edits and PR creation...")
        for patch in patch_instructions:
            path = patch.get("file_path", "")
            old_code = patch.get("old_code", "")
            new_code = patch.get("new_code", "")
            print(f"[DRY_RUN] File Target: {path}")
            print(f"[DRY_RUN] Replacing old_code:\n{old_code}\nWith new_code:\n{new_code}")
        print(f"[DRY_RUN] Simulating Git commit with title: {pr_title}")
        print(f"[DRY_RUN] Simulating PR creation with body:\n{pr_body}")
        
        # Return a simulated mock PR URL
        mock_pr_url = f"https://github.com/{repo}/pull/mock-auto-patch-123"
        return mock_pr_url

    try:
        # Config git bot identity
        subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
        subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], check=True)

        # Create unique patch branch name
        suffix = int(time.time())
        branch_name = f"fix/ai-auto-patch-{suffix}"
        
        print(f"Creating new branch: {branch_name}")
        subprocess.run(["git", "checkout", "-b", branch_name], check=True)

        # Iterate and apply file replacement patches
        modified_any = False
        for patch in patch_instructions:
            path = patch.get("file_path", "")
            old_code = patch.get("old_code", "")
            new_code = patch.get("new_code", "")

            if not path or not old_code or not new_code:
                continue

            if not os.path.exists(path):
                print(f"File not found: {path}")
                continue

            with open(path, "r", encoding="utf-8") as f:
                content = f.read()

            if old_code in content:
                print(f"Applying patch to {path}...")
                new_content = content.replace(old_code, new_code)
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                subprocess.run(["git", "add", path], check=True)
                modified_any = True
            else:
                print(f"Warning: Target 'old_code' not found in {path}. Patch skipped.")

        if not modified_any:
            print("No file was modified. Aborting PR creation.")
            subprocess.run(["git", "checkout", "main"], check=True)
            return ""

        # Commit changes
        commit_msg = pr_title if pr_title else f"Fix: AI auto-patch for {event_name}"
        subprocess.run(["git", "commit", "-m", commit_msg], check=True)
        
        # Push to remote
        print("Pushing branch to remote...")
        subprocess.run(["git", "push", "origin", branch_name], check=True)

        # Launch gh command to submit PR
        print("Creating Pull Request via GitHub CLI...")
        pr_cmd = [
            "gh", "pr", "create",
            "--title", pr_title,
            "--body", pr_body,
            "--head", branch_name,
            "--base", "main"
        ]
        result = subprocess.run(pr_cmd, capture_output=True, text=True, check=True)
        pr_url = result.stdout.strip()
        print(f"Pull Request created successfully: {pr_url}")
        
        # Safely return back to main branch
        subprocess.run(["git", "checkout", "main"], check=True)
        return pr_url

    except Exception as e:
        print(f"Failed to create Auto Patch PR: {e}")
        # Make sure we checkout main branch if git operations failed mid-process
        subprocess.run(["git", "checkout", "main"], capture_output=True)
        return ""
