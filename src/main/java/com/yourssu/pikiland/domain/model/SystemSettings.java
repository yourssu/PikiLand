package com.yourssu.pikiland.domain.model;

public class SystemSettings {
    private String githubAppId;
    private String githubPrivateKeyContent;
    private String githubWebhookSecret;
    private String githubClientId;
    private String githubClientSecret;

    // Server-side Only Global AI Credentials (For Log Path, Harness, Log Classifier)
    private String globalAiBaseUrl;
    private String globalAiApiKey;
    private String globalAiModel;

    public SystemSettings() {}

    public SystemSettings(String githubAppId, String githubPrivateKeyContent, String githubWebhookSecret,
                          String githubClientId, String githubClientSecret) {
        this(githubAppId, githubPrivateKeyContent, githubWebhookSecret, githubClientId, githubClientSecret, null, null, null);
    }

    public SystemSettings(String githubAppId, String githubPrivateKeyContent, String githubWebhookSecret,
                          String githubClientId, String githubClientSecret,
                          String globalAiBaseUrl, String globalAiApiKey, String globalAiModel) {
        this.githubAppId = githubAppId;
        this.githubPrivateKeyContent = githubPrivateKeyContent;
        this.githubWebhookSecret = githubWebhookSecret;
        this.githubClientId = githubClientId;
        this.githubClientSecret = githubClientSecret;
        this.globalAiBaseUrl = globalAiBaseUrl;
        this.globalAiApiKey = globalAiApiKey;
        this.globalAiModel = globalAiModel;
    }

    public String getGithubAppId() {
        return githubAppId;
    }

    public void setGithubAppId(String githubAppId) {
        this.githubAppId = githubAppId;
    }

    public String getGithubPrivateKeyContent() {
        return githubPrivateKeyContent;
    }

    public void setGithubPrivateKeyContent(String githubPrivateKeyContent) {
        this.githubPrivateKeyContent = githubPrivateKeyContent;
    }

    public String getGithubWebhookSecret() {
        return githubWebhookSecret;
    }

    public void setGithubWebhookSecret(String githubWebhookSecret) {
        this.githubWebhookSecret = githubWebhookSecret;
    }

    public String getGithubClientId() {
        return githubClientId;
    }

    public void setGithubClientId(String githubClientId) {
        this.githubClientId = githubClientId;
    }

    public String getGithubClientSecret() {
        return githubClientSecret;
    }

    public void setGithubClientSecret(String githubClientSecret) {
        this.githubClientSecret = githubClientSecret;
    }

    public String getGlobalAiBaseUrl() {
        return globalAiBaseUrl;
    }

    public void setGlobalAiBaseUrl(String globalAiBaseUrl) {
        this.globalAiBaseUrl = globalAiBaseUrl;
    }

    public String getGlobalAiApiKey() {
        return globalAiApiKey;
    }

    public void setGlobalAiApiKey(String globalAiApiKey) {
        this.globalAiApiKey = globalAiApiKey;
    }

    public String getGlobalAiModel() {
        return globalAiModel;
    }

    public void setGlobalAiModel(String globalAiModel) {
        this.globalAiModel = globalAiModel;
    }
}
