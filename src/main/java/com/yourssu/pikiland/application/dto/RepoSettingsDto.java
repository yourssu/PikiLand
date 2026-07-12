package com.yourssu.pikiland.application.dto;

public class RepoSettingsDto {
    private String fullName;
    private boolean active;
    private String slackWebhookUrl;
    private String customModel;

    public RepoSettingsDto() {}

    public RepoSettingsDto(String fullName, boolean active, String slackWebhookUrl, String customModel) {
        this.fullName = fullName;
        this.active = active;
        this.slackWebhookUrl = slackWebhookUrl;
        this.customModel = customModel;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public String getSlackWebhookUrl() {
        return slackWebhookUrl;
    }

    public void setSlackWebhookUrl(String slackWebhookUrl) {
        this.slackWebhookUrl = slackWebhookUrl;
    }

    public String getCustomModel() {
        return customModel;
    }

    public void setCustomModel(String customModel) {
        this.customModel = customModel;
    }
}
