import os
import sys
import shutil

# Add current scripts directory to Python path to ensure module importing works
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Force DRY_RUN mode for local simulation
os.environ["DRY_RUN"] = "true"
if not os.environ.get("EVENT_NAME"):
    os.environ["EVENT_NAME"] = "workflow_run"

# Relocate the dummy compilation error log here to keep analyze_error.py pure
dummy_gradle_log = (
    "[:compileJava] Compiling 15 source files...\n"
    "src/test/java/com/example/demo/DemoApplicationTests.java:5: error: cannot find symbol\n"
    "        User user = new User(\"test\", \"test@example.com\");\n"
    "        ^\n"
    "  symbol:   class User\n"
    "  location: class DemoApplicationTests\n"
    "BUILD FAILED in 2s\n"
)
os.environ["MOCK_ERROR_LOG"] = dummy_gradle_log

def create_local_mock_files():
    """Creates temporary mock source code files to enable LLM tool-calling dry-runs without manual setup."""
    print("Creating temporary mock Java source files for local dry-run simulation...", flush=True)
    os.makedirs("src/main/java/com/example/demo/domain", exist_ok=True)
    os.makedirs("src/test/java/com/example/demo", exist_ok=True)
    
    user_code = (
        "package com.example.demo.domain;\n\n"
        "public class User {\n"
        "    private String name;\n"
        "    private String email;\n"
        "    public User(String name, String email) {\n"
        "        this.name = name;\n"
        "        this.email = email;\n"
        "    }\n"
        "}\n"
    )
    test_code = (
        "package com.example.demo;\n\n"
        "public class DemoApplicationTests {\n"
        "    public void testUserCreation() {\n"
        "        User user = new User(\"test\", \"test@example.com\");\n"
        "    }\n"
        "}\n"
    )
    
    with open("src/main/java/com/example/demo/domain/User.java", "w", encoding="utf-8") as f:
        f.write(user_code)
    with open("src/test/java/com/example/demo/DemoApplicationTests.java", "w", encoding="utf-8") as f:
        f.write(test_code)

def cleanup_local_mock_files():
    """Removes the temporary mock directory structure used during local simulation."""
    print("Cleaning up temporary mock Java files...", flush=True)
    if os.path.exists("src"):
        shutil.rmtree("src")

def main():
    try:
        create_local_mock_files()
        
        # Import analyze_error and run its main pipeline
        import analyze_error
        analyze_error.main()
        
    finally:
        cleanup_local_mock_files()

if __name__ == "__main__":
    main()
