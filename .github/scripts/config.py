import os

def load_dotenv(env_path=".env"):
    """
    Loads environment variables from a local .env file if it exists.
    Does NOT overwrite variables already configured in the system environment (like GitHub Secrets).
    """
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
                    
                    # Standardize common lower-case configuration variables
                    target_keys = [k]
                    if k == "API_KEY":
                        target_keys.append("AI_API_KEY")
                    elif k == "SLACK_WEBHOOK_URL":
                        target_keys.append("SLACK_WEBHOOK_URL")
                    elif k == "AI_MODEL":
                        target_keys.append("AI_MODEL")
                    elif k == "BASE_URL":
                        target_keys.append("AI_BASE_URL")
                    
                    # Ensure pre-defined OS environment variables take precedence
                    for tk in target_keys:
                        if tk not in os.environ:
                            os.environ[tk] = v
