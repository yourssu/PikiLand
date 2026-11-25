CREATE TABLE incidents (
    incident_id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL REFERENCES repositories(repo_id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL,
    pr_generated INTEGER NOT NULL CHECK (pr_generated IN (0, 1)),
    pr_link TEXT,
    summary TEXT NOT NULL,
    context TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (repo_id, incident_id),
    CHECK ((pr_generated = 1 AND pr_link IS NOT NULL AND length(pr_link) > 0)
        OR (pr_generated = 0 AND pr_link IS NULL)),
    CHECK (CASE WHEN json_valid(context) THEN
        json_type(context) = 'object'
        AND json_type(context, '$.llm') IS 'object'
        AND json_type(context, '$.fluent_bit') IS 'array'
        AND json_type(context, '$.llm.messages') IS 'array'
        AND json_array_length(context, '$.llm.messages') >= 1
        ELSE 0 END)
);
CREATE INDEX incidents_order ON incidents (repo_id, occurred_at DESC, incident_id DESC);
