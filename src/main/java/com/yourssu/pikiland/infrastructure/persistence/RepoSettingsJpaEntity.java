package com.yourssu.pikiland.infrastructure.persistence;

import com.yourssu.pikiland.domain.model.HarnessSource;
import com.yourssu.pikiland.domain.model.HarnessStatus;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "repo_settings")
public class RepoSettingsJpaEntity {

    @Id
    private String repositoryFullName;
    private boolean active;
    private String slackWebhookUrl;
    private String customModel;
    private String customBaseUrl;
    private String harnessCmd;
    private String inferredHarnessCmd;

    @Enumerated(EnumType.STRING)
    private HarnessStatus harnessStatus;

    @Enumerated(EnumType.STRING)
    private HarnessSource harnessSource;

    private int ralphMaxRetries = 3;

    public RepoSettingsJpaEntity() {}

    public RepoSettingsJpaEntity(String repositoryFullName, boolean active, String slackWebhookUrl, String customModel, String customBaseUrl,
                                String harnessCmd, String inferredHarnessCmd, HarnessStatus harnessStatus, HarnessSource harnessSource, int ralphMaxRetries) {
        this.repositoryFullName = repositoryFullName;
        this.active = active;
        this.slackWebhookUrl = slackWebhookUrl;
        this.customModel = customModel;
        this.customBaseUrl = customBaseUrl;
        this.harnessCmd = harnessCmd;
        this.inferredHarnessCmd = inferredHarnessCmd;
        this.harnessStatus = harnessStatus;
        this.harnessSource = harnessSource;
        this.ralphMaxRetries = ralphMaxRetries > 0 ? ralphMaxRetries : 3;
    }

    public String getRepositoryFullName() {
        return repositoryFullName;
    }

    public void setRepositoryFullName(String repositoryFullName) {
        this.repositoryFullName = repositoryFullName;
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

    public HarnessStatus getHarnessStatus() {
        return harnessStatus;
    }

    public void setHarnessStatus(HarnessStatus harnessStatus) {
        this.harnessStatus = harnessStatus;
    }

    public HarnessSource getHarnessSource() {
        return harnessSource;
    }

    public void setHarnessSource(HarnessSource harnessSource) {
        this.harnessSource = harnessSource;
    }

    public int getRalphMaxRetries() {
        return ralphMaxRetries;
    }

    public void setRalphMaxRetries(int ralphMaxRetries) {
        this.ralphMaxRetries = ralphMaxRetries;
    }
}


