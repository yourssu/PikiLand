# Production log observation pipeline

This is the current implementation contract, superseding older CI/Issue-input and Fluent Bit installation instructions. Workflow failure and Issue creation no longer create incidents. GitHub Actions remains the engine execution environment. PR webhooks update an explicitly matched production incident; there is no fallback to an unrelated latest incident.

## What ordinary logs can establish

The Python standard-library observer supports nginx/Apache-compatible common or combined access logs, with debugging disabled. It also accepts existing JSON access logs with `request_method`, `uri`, `status`, `body_bytes_sent`, and optional `request_time` in seconds. It does not read application bodies, inspect traffic, call production endpoints, or modify web-server configuration.

| Detector | Requirement | Meaning |
| --- | --- | --- |
| `http_5xx` | Common/combined access log | Sustained server-error response ratio |
| `redirect_shift` | Common/combined access log | Sustained increase in redirects excluding 304 |
| `empty_response_shift` | Common/combined access log | Sustained increase in zero-byte 200 responses, excluding HEAD |
| `response_contract` | Explicit operator route contract | Status or response size violates the registered expectation |
| `latency_contract` | Existing JSON timing field + operator limit | Request time exceeds the registered expectation |

These are investigation candidates, not proof of code defects. Default access logs cannot identify wrong prices, missed asynchronous completion, transaction state, or incorrect content with a normal size. State-transition/business-invariant detectors are deliberately not fabricated from missing fields. No automatic logging expansion/debug enablement is performed. The `/api/production/health` endpoint reports capabilities and collection gaps; missing timing prevents latency claims.

Official format references: [nginx access logging](https://nginx.org/en/docs/http/ngx_http_log_module.html), [nginx debugging](https://nginx.org/en/docs/debugging_log.html).

## Local observer

`observer/observer.py` requires Python 3.9+ and reads **one existing file** without modifying it. It starts at EOF, handles append/rename/copy-truncate, caps individual lines at 16 KiB and reads at most 256 KiB per one-second tick. Delayed or incomplete windows are excluded, not interpreted as failure. Windows use observation time; pre-buffered logging can delay detection.

Defaults:

- 60-second windows, at least 100 requests, two consecutive qualifying windows.
- Explicit rules: at least five violations and 5% of the window.
- Distribution shifts: six healthy baseline windows, at least 20 percentage points and 3× the baseline rate, at least ten observations.
- 15-minute per-rule cooldown; baseline is not updated during detected anomalies.
- Startup, invalid-format and lag windows reset confidence. Restart deliberately warms a new baseline.
- At most 32 literal configured paths; all other paths go to `all`. Only operator labels are exported, never raw URLs.
- Five numeric exemplars per candidate. Client address, user, query string, referrer, user agent, headers and bodies are discarded before persistence/export.
- Durable SQLite pending queue of at most 256 candidates, expiring after 24 hours. One HTTPS transmission per ten seconds, three-second timeout, no redirects. Failed sends keep the same signal ID. Dropped-candidate counts are reported by heartbeat.
- One bounded health report per minute; coordinator marks it stale after three minutes. A stale observer does not claim the service is healthy.

The observer is a separate process, not a synchronous application hook. It still consumes finite CPU/I/O; zero overhead cannot be guaranteed without measurement. Under load it drops observation completeness rather than backpressuring the application.

## Installation

The dashboard provisions only a **new, dedicated observer service**. Prerequisites: Linux/systemd, `/usr/bin/python3` 3.9+, non-root SSH account with existing access-log read permission and permission to install its dedicated service, verified SHA-256 SSH host-key fingerprint in hex, verified HTTPS coordinator certificate. Installation fails if prerequisites are missing; it does not install packages or change log ownership, ACLs or modes.

- Fixed service namespace per repository, private config/token mode 0600, state directory 0700.
- `MemoryMax=64M`, `CPUQuota=5%`, `IOWeight=10`, `Nice=19`, `TasksMax=8`.
- No capabilities, no new privileges, read-only system, protected home/kernel/control groups and private temporary directory.
- Does not overwrite or restart a shared Fluent Bit service, nginx, or an existing observer installation.
- SSH host-key checking and HTTPS certificate verification are mandatory.
- No production server has been changed by implementing this feature. Validate resource usage and the chosen non-root account on staging before installation.

If log access is unavailable, the operator must arrange an appropriately isolated account externally. The pipeline will not widen production permissions. If timing is absent, use an already-approved timing access log or leave latency detection unavailable; the pipeline will not reload nginx or enable debug.

The generated private `config.json` has an optional `routes` array. Example route entry:

```json
{"path":"/catalog","label":"catalog","statuses":[200],"minBytes":1}
```

Set expectations only where they are valid (authentication, redirects, cache behavior, and empty results can be legitimate). For an existing JSON timing log, `maxDurationMs` adds a latency contract. Restart only the dedicated observer after reviewing a local collector configuration change. Do not add secrets or user identifiers to labels.

## Coordinator

`POST /api/production/signals` accepts versioned, strictly validated, at-most-32-KiB candidate bodies. Requires an enabled repository, enabled log ingestion and its collector token. Counts, ratios and windows must agree; stale/future data and unknown raw fields are rejected.

A single SQLite transaction records the deduplicated signal, immutable incident evidence and queued analysis. Repeated transport delivery does not increment occurrences. Related observations increment one repository/environment/service/observer/rule/route incident; they do not replace evidence once analysis is scheduled or trigger duplicate PRs. Initially incomplete evidence can be upgraded before scheduling.

`production_jobs` separates analysis state (`QUEUED`, `DISPATCHING`, `DISPATCHED`, `DISPATCH_UNKNOWN`, `COMPLETED`) from the incident. The in-process worker runs every five seconds on normal app startup, claiming jobs atomically. Limits: two outstanding/uncertain jobs and ten analysis dispatches per day per repository. The signal inbox expires after seven days; new incident identities are capped at 1,000 per repository. Review/archive old incidents as an operational task rather than unbounded storage growth.

A dispatch interrupted or timed out is **ambiguous**, so it is not retried blindly. An operator must reconcile GitHub Actions before rescheduling it. The workflow has incident-keyed concurrency and a 45-minute timeout. No workflow failure opens a new incident. Engine completion posts an authenticated result to `/api/production/incidents/:id/result`.

Incident detail access accepts the enabled repository's collector credential or a GitHub token validated against that exact repository with write permission. A fabricated `ghs_` prefix is no longer accepted. Legacy `/api/logs/ingest` accepts bounded, redacted explicit-error logs and now uses the same durable queue; existing integrations must enable log ingestion.

PR merge yields `AWAITING_DEPLOYMENT`, not `RESOLVED`. Automatic deployment/recovery confirmation is not inferred from an absence of logs. In this version operators confirm recovery; lifecycle records and job outcomes remain separate.

## Deployment and verification

Merge/release the companion Engine change first. New engine behavior requires a tracked `.pikiland/production-verification.json`; absent or unprovable expectations produce `NEEDS_EVIDENCE`, with no patch/PR. The policy cannot be replaced by an AI confidence score or generic passing tests. Install the new coordinator and then opt in individual observers. There is no automatic remote rollout.

Run:

- `bun run test`
- `bun run typecheck`
- `python3 -m unittest discover -s observer -v`
- `ENGINE_WORKSPACE_PATH=/path/to/pikiland-engine bun scripts/test-production-contract.ts`

The contract test uses actual Python detection, coordinator routes/SQLite, Engine and real failing/passing fixture tests. AI and GitHub publication are mocked. This is not a live LLM, hosted GitHub Actions, nginx deployment, or real self-healing PR validation.
