package com.yourssu.pikiland.application.dto;

public class RepoSettingsDto {
    private String fullName;
    private boolean active;
    private String slackWebhookUrl;
    private String customModel;
    private String customBaseUrl;
    private String harnessCmd;
    private String inferredHarnessCmd;
    private String harnessStatus;
    private String harnessSource;
    private int ralphMaxRetries;
    private boolean hasAppInstalled;
    private String inferenceMessage;

    public RepoSettingsDto() {}

    public RepoSettingsDto(String fullName, boolean active, String slackWebhookUrl, String customModel, String harnessCmd) {
        this(fullName, active, slackWebhookUrl, customModel, "", harnessCmd, "", "NONE", "NONE", 3, false);
    }

    public RepoSettingsDto(String fullName, boolean active, String slackWebhookUrl, String customModel, String customBaseUrl,
                           String harnessCmd, String inferredHarnessCmd, String harnessStatus, String harnessSource, int ralphMaxRetries) {
        this(fullName, active, slackWebhookUrl, customModel, customBaseUrl, harnessCmd, inferredHarnessCmd, harnessStatus, harnessSource, ralphMaxRetries, false);
    }

    public RepoSettingsDto(String fullName, boolean active, String slackWebhookUrl, String customModel, String customBaseUrl,
                           String harnessCmd, String inferredHarnessCmd, String harnessStatus, String harnessSource, int ralphMaxRetries, boolean hasAppInstalled) {
        this.fullName = fullName;
        this.active = active;
        this.slackWebhookUrl = slackWebhookUrl;
        this.customModel = customModel;
        this.customBaseUrl = customBaseUrl;
        this.harnessCmd = harnessCmd;
        this.inferredHarnessCmd = inferredHarnessCmd;
        this.harnessStatus = harnessStatus;
        this.harnessSource = harnessSource;
        this.ralphMaxRetries = ralphMaxRetries > 0 ? ralphMaxRetries : 3;
        this.hasAppInstalled = hasAppInstalled;
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

    public String getCustomBaseUrl() {
        return customBaseUrl;
    }

    public void setCustomBaseUrl(String customBaseUrl) {
        this.customBaseUrl = customBaseUrl;
    }

    public String getHarnessCmd() {
        return harnessCmd;
    }

    public void setHarnessCmd(String harnessCmd) {
        this.harnessCmd = harnessCmd;
    }

    public String getInferredHarnessCmd() {
        return inferredHarnessCmd;
    }

    public void setInferredHarnessCmd(String inferredHarnessCmd) {
        this.inferredHarnessCmd = inferredHarnessCmd;
    }

    public String getHarnessStatus() {
        return harnessStatus;
    }

    public void setHarnessStatus(String harnessStatus) {
        this.harnessStatus = harnessStatus;
    }

    public String getHarnessSource() {
        return harnessSource;
    }

    public void setHarnessSource(String harnessSource) {
        this.harnessSource = harnessSource;
    }

    public int getRalphMaxRetries() {
        return ralphMaxRetries;
    }

    public void setRalphMaxRetries(int ralphMaxRetries) {
        this.ralphMaxRetries = ralphMaxRetries;
    }

    public boolean isHasAppInstalled() {
        return hasAppInstalled;
    }

    public void setHasAppInstalled(boolean hasAppInstalled) {
        this.hasAppInstalled = hasAppInstalled;
    }

    public String getInferenceMessage() {
        return inferenceMessage;
    }

    public void setInferenceMessage(String inferenceMessage) {
        this.inferenceMessage = inferenceMessage;
    }
}


