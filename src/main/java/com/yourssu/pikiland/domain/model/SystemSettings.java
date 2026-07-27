package com.yourssu.pikiland.domain.model;

public class SystemSettings {
    private String githubAppId;
    private String githubPrivateKeyContent;
    private String githubWebhookSecret;
    private String githubClientId;
    private String githubClientSecret;

    public SystemSettings() {}

    public SystemSettings(String githubAppId, String githubPrivateKeyContent, String githubWebhookSecret,
                          String githubClientId, String githubClientSecret) {
        this.githubAppId = githubAppId;
        this.githubPrivateKeyContent = githubPrivateKeyContent;
        this.githubWebhookSecret = githubWebhookSecret;
        this.githubClientId = githubClientId;
        this.githubClientSecret = githubClientSecret;
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
}
