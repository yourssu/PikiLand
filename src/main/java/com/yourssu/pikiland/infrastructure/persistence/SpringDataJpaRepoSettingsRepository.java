package com.yourssu.pikiland.infrastructure.persistence;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface SpringDataJpaRepoSettingsRepository extends JpaRepository<RepoSettingsJpaEntity, String> {
}
