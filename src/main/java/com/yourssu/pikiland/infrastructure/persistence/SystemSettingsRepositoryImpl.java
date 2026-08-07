package com.yourssu.pikiland.infrastructure.persistence;

import com.yourssu.pikiland.domain.model.SystemSettings;
import com.yourssu.pikiland.domain.port.SystemSettingsRepository;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class SystemSettingsRepositoryImpl implements SystemSettingsRepository {

    private final SpringDataJpaSystemSettingsRepository jpaRepository;

    public SystemSettingsRepositoryImpl(SpringDataJpaSystemSettingsRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public Optional<SystemSettings> findGlobalSettings() {
        return jpaRepository.findById("GLOBAL").map(this::toDomain);
    }

    @Override
    public void saveGlobalSettings(SystemSettings settings) {
        jpaRepository.save(toJpaEntity(settings));
    }

    private SystemSettings toDomain(SystemSettingsJpaEntity entity) {
        return new SystemSettings(
                entity.getGithubAppId(),
                entity.getGithubPrivateKeyContent(),
                entity.getGithubWebhookSecret(),
                entity.getGithubClientId(),
                entity.getGithubClientSecret(),
                entity.getGlobalAiBaseUrl(),
                entity.getGlobalAiApiKey(),
                entity.getGlobalAiModel()
        );
    }

    private SystemSettingsJpaEntity toJpaEntity(SystemSettings domain) {
        return new SystemSettingsJpaEntity(
                "GLOBAL",
                domain.getGithubAppId(),
                domain.getGithubPrivateKeyContent(),
                domain.getGithubWebhookSecret(),
                domain.getGithubClientId(),
                domain.getGithubClientSecret(),
                domain.getGlobalAiBaseUrl(),
                domain.getGlobalAiApiKey(),
                domain.getGlobalAiModel()
        );
    }
}
