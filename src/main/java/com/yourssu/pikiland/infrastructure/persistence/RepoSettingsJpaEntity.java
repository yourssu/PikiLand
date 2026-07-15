package com.yourssu.pikiland.infrastructure.persistence;

import jakarta.persistence.Entity;
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
    private String harnessCmd;

    public RepoSettingsJpaEntity() {}

    public RepoSettingsJpaEntity(String repositoryFullName, boolean active, String slackWebhookUrl, String customModel, String harnessCmd) {
        this.repositoryFullName = repositoryFullName;
        this.active = active;
        this.slackWebhookUrl = slackWebhookUrl;
        this.customModel = customModel;
        this.harnessCmd = harnessCmd;
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

    public String getHarnessCmd() {
        return harnessCmd;
    }

    public void setHarnessCmd(String harnessCmd) {
        this.harnessCmd = harnessCmd;
    }
}

