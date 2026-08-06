package com.yourssu.pikiland.domain.port;

import com.yourssu.pikiland.domain.model.LogFingerprint;
import java.util.Optional;

public interface LogFingerprintRepository {
    Optional<LogFingerprint> findByHash(String hash);
    java.util.List<LogFingerprint> findAllByRepository(String repositoryFullName);
    LogFingerprint save(LogFingerprint logFingerprint);
}
