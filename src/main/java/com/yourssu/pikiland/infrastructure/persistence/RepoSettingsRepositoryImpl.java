package com.yourssu.pikiland.infrastructure.persistence;

import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Component
public class RepoSettingsRepositoryImpl implements RepoSettingsRepository {

    private final SpringDataJpaRepoSettingsRepository jpaRepository;

    public RepoSettingsRepositoryImpl(SpringDataJpaRepoSettingsRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public Optional<RepoSettings> findById(String id) {
        return jpaRepository.findById(id)
                .map(this::toDomain);
    }

    @Override
    public List<RepoSettings> findAll() {
        return jpaRepository.findAll().stream()
                .map(this::toDomain)
                .collect(Collectors.toList());
    }

    @Override
    public void save(RepoSettings settings) {
        jpaRepository.save(toJpaEntity(settings));
    }

    private RepoSettings toDomain(RepoSettingsJpaEntity entity) {
        return new RepoSettings(
                entity.getRepositoryFullName(),
                entity.isActive(),
                entity.getSlackWebhookUrl(),
                entity.getCustomModel()
        );
    }

    private RepoSettingsJpaEntity toJpaEntity(RepoSettings domain) {
        return new RepoSettingsJpaEntity(
                domain.getRepositoryFullName(),
                domain.isActive(),
                domain.getSlackWebhookUrl(),
                domain.getCustomModel()
        );
    }
}
