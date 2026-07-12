package com.yourssu.pikiland.domain.model;

public class RepoSettings {
    private final String repositoryFullName;
    private boolean active;
    private String slackWebhookUrl;
    private String customModel;

    public RepoSettings(String repositoryFullName, boolean active, String slackWebhookUrl, String customModel) {
        if (repositoryFullName == null || repositoryFullName.isBlank()) {
            throw new IllegalArgumentException("Repository full name cannot be null or empty");
        }
        this.repositoryFullName = repositoryFullName;
        this.active = active;
        this.slackWebhookUrl = slackWebhookUrl;
        this.customModel = customModel;
    }

    public void configureSlack(String webhookUrl) {
        if (webhookUrl != null && !webhookUrl.isBlank() && !webhookUrl.startsWith("https://")) {
            throw new IllegalArgumentException("Slack webhook URL must start with https://");
        }
        this.slackWebhookUrl = webhookUrl;
    }

    public void configureCustomModel(String model) {
        this.customModel = model;
    }

    public void toggleActive(boolean active) {
        this.active = active;
    }

    public String getRepositoryFullName() {
        return repositoryFullName;
    }

    public boolean isActive() {
        return active;
    }

    public String getSlackWebhookUrl() {
        return slackWebhookUrl;
    }

    public String getCustomModel() {
        return customModel;
    }
}
