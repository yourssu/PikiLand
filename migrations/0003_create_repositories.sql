CREATE TABLE repositories (
    repo_id INTEGER PRIMARY KEY,
    installation_id INTEGER NOT NULL,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    branch TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    llm_base_url TEXT NOT NULL,
    llm_api_key_ciphertext TEXT NOT NULL,
    llm_model_name TEXT NOT NULL CHECK (length(llm_model_name) >= 1),
    slack_webhook_url_ciphertext TEXT NOT NULL,
    prod_server_url TEXT NOT NULL,
    prod_server_token_ciphertext TEXT NOT NULL,
    config_extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_extra) = 1 AND json_type(config_extra) = 'object'),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (json_type(config_extra, '$.llm_base_url') IS NULL
       AND json_type(config_extra, '$.llm_api_key') IS NULL
       AND json_type(config_extra, '$.llm_model_name') IS NULL
       AND json_type(config_extra, '$.slack_webhook_url') IS NULL
       AND json_type(config_extra, '$.prod_server_url') IS NULL
       AND json_type(config_extra, '$.prod_server_token') IS NULL)
);
CREATE INDEX repositories_installation ON repositories (installation_id);
CREATE INDEX repositories_active ON repositories (is_active, repo_id);
