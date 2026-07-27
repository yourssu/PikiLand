package com.yourssu.pikiland.domain.model;

public class RepoSettings {
    private final String repositoryFullName;
    private boolean active;
    private String slackWebhookUrl;
    private String customModel;
    private String customBaseUrl;
    private String harnessCmd;
    private String inferredHarnessCmd;
    private HarnessStatus harnessStatus;
    private HarnessSource harnessSource;
    private int ralphMaxRetries;

    public RepoSettings(String repositoryFullName, boolean active, String slackWebhookUrl, String customModel, String harnessCmd) {
        this(repositoryFullName, active, slackWebhookUrl, customModel, "", harnessCmd, null,
                (harnessCmd != null && !harnessCmd.isBlank()) ? HarnessStatus.ACTIVE : HarnessStatus.NONE,
                (harnessCmd != null && !harnessCmd.isBlank()) ? HarnessSource.USER_PROVIDED : HarnessSource.NONE,
                3);
    }

    public RepoSettings(String repositoryFullName, boolean active, String slackWebhookUrl, String customModel, String customBaseUrl,
                        String harnessCmd, String inferredHarnessCmd, HarnessStatus harnessStatus, HarnessSource harnessSource, int ralphMaxRetries) {
        if (repositoryFullName == null || repositoryFullName.isBlank()) {
            throw new IllegalArgumentException("Repository full name cannot be null or empty");
        }
        this.repositoryFullName = repositoryFullName;
        this.active = active;
        this.slackWebhookUrl = slackWebhookUrl;
        this.customModel = customModel;
        this.customBaseUrl = customBaseUrl;
        this.harnessCmd = harnessCmd;
        this.inferredHarnessCmd = inferredHarnessCmd;
        this.harnessStatus = harnessStatus != null ? harnessStatus : HarnessStatus.NONE;
        this.harnessSource = harnessSource != null ? harnessSource : HarnessSource.NONE;
        this.ralphMaxRetries = ralphMaxRetries > 0 ? ralphMaxRetries : 3;
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

    public void configureCustomBaseUrl(String baseUrl) {
        this.customBaseUrl = baseUrl;
    }

    public void configureHarnessCmd(String harnessCmd) {
        this.harnessCmd = harnessCmd;
        this.harnessStatus = (harnessCmd != null && !harnessCmd.isBlank()) ? HarnessStatus.ACTIVE : HarnessStatus.NONE;
        this.harnessSource = HarnessSource.USER_PROVIDED;
    }

    public void configureRalphMaxRetries(int maxRetries) {
        this.ralphMaxRetries = maxRetries > 0 ? maxRetries : 3;
    }

    public void setInferredHarness(String inferredCmd, HarnessSource source) {
        this.inferredHarnessCmd = inferredCmd;
        this.harnessSource = source != null ? source : HarnessSource.AUTO_INFERRED;
        this.harnessStatus = (inferredCmd != null && !inferredCmd.isBlank()) ? HarnessStatus.PENDING_CONFIRMATION : HarnessStatus.FAILED;
    }

    public void approveInferredHarness() {
        if (this.inferredHarnessCmd != null && !this.inferredHarnessCmd.isBlank()) {
            this.harnessCmd = this.inferredHarnessCmd;
            this.harnessStatus = HarnessStatus.ACTIVE;
        }
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

    public String getCustomBaseUrl() {
        return customBaseUrl;
    }

    public String getHarnessCmd() {
        return harnessCmd;
    }

    public String getInferredHarnessCmd() {
        return inferredHarnessCmd;
    }

    public HarnessStatus getHarnessStatus() {
        return harnessStatus;
    }

    public HarnessSource getHarnessSource() {
        return harnessSource;
    }

    public int getRalphMaxRetries() {
        return ralphMaxRetries;
    }
}



