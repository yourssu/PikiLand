# AGENTS.md

## 🤖 Overview
Welcome to PikiLand! You are an agent interacting with a system designed to automatically detect, analyze, and patch software errors from GitHub. This project is part of the "PikiLand" ecosystem, which aims to reduce developer on-call burden by providing verified Pull Requests (PRs) for CI failures and GitHub Issues.

## 🛠 Project Core Concepts

### 1. Two Operational Modes
*   **Web App Mode (Coordinator)**: The TypeScript + Bun (Hono) application in this repository (`yourssu/PikiLand`) that handles webhooks, manages repository settings, and orchestrates the overall flow. It acts as the "brain."
*   **CLI Mode (Execution Engine)**: Resides in a separate repository (`yourssu/PikiLand-Engine`) and runs inside GitHub Actions. This is where the heavy lifting happens: analyzing logs, running tests, applying patches, and executing the **Ralph Loop**.

### 2. The Ralph Loop & Harness
*   **Harness**: A command (e.g., `bun test`, `./gradlew test`, `pytest`, `cargo test`) that must be executable in the target repository to reproduce an error (*Red*) and verify a fix (*Green*).
*   **Ralph Loop**: An iterative process where we feed harness failure logs back into an AI model to refine the patch. We repeat this up to a maximum number of retries (`PIKILAND_RALPH_MAX_RETRIES`).

### 3. Data Pipeline: Context Bundles
PikiLand links disparate data points (CI logs, Sentry errors, PostHog events) into a **Context Bundle**. This bundle provides the necessary context for an agent to understand what went wrong and how to fix it.

## 🚦 Guidelines for Agents

### ✅ DO
*   **Read First**: Always read existing files, especially `README.md`, `docs/DESIGN.md`, and `docs/ARCHITECTURE_AND_DATA_PIPELINE.md` before making changes.
*   **Understand the Harness**: If you are working on a feature or fixing a bug, identify the command that serves as the "Harness" for verification.
*   **Verify via Tests**: Never assume a change works. Run the relevant test suite or the specific harness command (`bun test`) to ensure the fix is valid and doesn't introduce regressions.
*   **Follow Existing Patterns**: Mimic the existing TypeScript / Bun / Hono patterns, directory structures, and coding styles (e.g., use `services`, `routes`, `repositories` appropriately).
*   **Respect the "Single Best PR" Rule**: PikiLand's goal is to provide only the *single best* verified patch, not dozens of unverified ones. Design features that support this ranking/filtering logic.
*   **Maintain Security**: Never hardcode secrets or expose sensitive log data (PII) in any output or PR description.

### ❌ DO NOT
*   **Do Not Guess**: If a module, class, or configuration is unclear, use `grep` or `glob` to find it or ask the user/advisor for clarification.
*   **Do Not Refactor Without Reason**: Do not clean up surrounding code or change styles unless explicitly requested. Keep changes "surgical."
*   **Do Not Ignore the Ralph Loop**: When implementing automation, ensure you consider how failure logs will be fed back into the loop.
*   **Do Not Create Unverifiable Patches**: Do not suggest or implement logic that bypasses the need for a reproducible harness.
*   **Do Not Use Exception Catch**: When you Accept Exception from log or user, Do not make a Method for Exception Catch. Simply, patch code where exception occurs to resolve it.

## 📂 Key Directories
*   `src/`: The core TypeScript / Hono source code (`db/`, `domain/`, `routes/`, `services/`, `views/`).
*   `tests/`: Comprehensive test suite written for `bun:test`.
*   `docs/`: Detailed design, architecture, and pipeline documentation.
*   `data/`: SQLite database storage (`data/pikiland.sqlite`).
*   `package.json`: Project dependencies and script configuration.

## 🚀 Verification Commands
*Check `package.json` for project-specific commands.*
Generally:
*   Run all tests: `bun test`
*   Run specific test: `bun test tests/pipeline-integration.test.ts`
*   Run typecheck: `bun run typecheck`

---
*End of AGENTS.md*
