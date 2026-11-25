CREATE TABLE incident_engine_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'active', 'completed', 'cancelled')),
    workflow_ref TEXT NOT NULL CHECK (length(workflow_ref) > 0),
    github_run_id TEXT,
    run_attempt INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    activated_at INTEGER,
    finished_at INTEGER,
    UNIQUE (repo_id, id),
    UNIQUE (repo_id, github_run_id, run_attempt),
    CHECK ((github_run_id IS NULL AND run_attempt IS NULL)
        OR (github_run_id IS NOT NULL AND length(github_run_id) > 0
            AND github_run_id NOT GLOB '*[^0-9]*' AND run_attempt IS NOT NULL AND run_attempt >= 1 AND typeof(run_attempt) = 'integer'))
);
CREATE UNIQUE INDEX incident_engine_one_active ON incident_engine_runs (repo_id) WHERE state = 'active';
CREATE INDEX incident_engine_queue ON incident_engine_runs (repo_id, state, id);

CREATE TABLE incident_engine_run_incidents (
    run_id INTEGER PRIMARY KEY,
    repo_id INTEGER NOT NULL,
    incident_id INTEGER NOT NULL,
    UNIQUE (repo_id, run_id),
    FOREIGN KEY (repo_id, run_id) REFERENCES incident_engine_runs(repo_id, id) ON DELETE CASCADE,
    FOREIGN KEY (repo_id, incident_id) REFERENCES incidents(repo_id, incident_id) ON DELETE CASCADE
);
CREATE TRIGGER incident_cancel_reserved BEFORE DELETE ON incidents BEGIN
    UPDATE incident_engine_runs SET state = 'cancelled', finished_at = unixepoch()
    WHERE state = 'reserved' AND id IN (
        SELECT run_id FROM incident_engine_run_incidents
        WHERE repo_id = OLD.repo_id AND incident_id = OLD.incident_id
    );
END;

CREATE TABLE oidc_replays (
    jti TEXT PRIMARY KEY NOT NULL CHECK (length(jti) > 0),
    expires_at INTEGER NOT NULL
);
CREATE TABLE repository_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    repo_id INTEGER NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('fluentbit', 'engine')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    oidc_jti TEXT UNIQUE,
    run_id TEXT,
    run_attempt INTEGER,
    workflow_ref TEXT,
    engine_run_id INTEGER,
    FOREIGN KEY (repo_id, engine_run_id) REFERENCES incident_engine_run_incidents(repo_id, run_id) ON DELETE CASCADE,
    CHECK ((purpose = 'fluentbit' AND expires_at IS NULL AND oidc_jti IS NULL
        AND run_id IS NULL AND run_attempt IS NULL AND workflow_ref IS NULL AND engine_run_id IS NULL)
        OR (purpose = 'engine' AND typeof(expires_at) = 'integer'
            AND expires_at > created_at AND expires_at <= created_at + 21900
            AND oidc_jti IS NOT NULL AND length(oidc_jti) > 0
            AND run_id IS NOT NULL AND length(run_id) > 0 AND run_id NOT GLOB '*[^0-9]*'
            AND typeof(run_attempt) = 'integer' AND run_attempt >= 1
            AND workflow_ref IS NOT NULL AND length(workflow_ref) > 0 AND engine_run_id IS NOT NULL))
);
CREATE UNIQUE INDEX repository_token_current ON repository_tokens(repo_id, purpose) WHERE revoked_at IS NULL;
CREATE INDEX repository_tokens_expiry ON repository_tokens(expires_at);
