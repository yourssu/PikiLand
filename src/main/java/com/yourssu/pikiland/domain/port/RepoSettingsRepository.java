package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.RepoSettings;
import java.util.Optional;
import java.util.List;

public interface RepoSettingsRepository {
    Optional<RepoSettings> findById(String id);
    List<RepoSettings> findAll();
    void save(RepoSettings settings);
}
