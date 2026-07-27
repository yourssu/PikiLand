package com.yourssu.pikiland.infrastructure.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;

@Entity
@Table(name = "system_settings")
public class SystemSettingsJpaEntity {

    @Id
    private String id = "GLOBAL";

    private String githubAppId;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String githubPrivateKeyContent;

    private String githubWebhookSecret;
    private String githubClientId;
    private String githubClientSecret;

    public SystemSettingsJpaEntity() {}

    public SystemSettingsJpaEntity(String id, String githubAppId, String githubPrivateKeyContent,
                                  String githubWebhookSecret, String githubClientId, String githubClientSecret) {
        this.id = id != null ? id : "GLOBAL";
        this.githubAppId = githubAppId;
        this.githubPrivateKeyContent = githubPrivateKeyContent;
        this.githubWebhookSecret = githubWebhookSecret;
        this.githubClientId = githubClientId;
        this.githubClientSecret = githubClientSecret;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
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
