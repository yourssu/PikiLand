package com.yourssu.pikiland.infrastructure.persistence;

import com.yourssu.pikiland.domain.model.LogFingerprint;
import com.yourssu.pikiland.domain.port.LogFingerprintRepository;
import org.springframework.stereotype.Repository;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Repository
public class InMemoryLogFingerprintRepository implements LogFingerprintRepository {

    private final Map<String, LogFingerprint> store = new ConcurrentHashMap<>();

    @Override
    public Optional<LogFingerprint> findByHash(String hash) {
        if (hash == null) return Optional.empty();
        return Optional.ofNullable(store.get(hash));
    }

    @Override
    public java.util.List<LogFingerprint> findAllByRepository(String repositoryFullName) {
        if (repositoryFullName == null) return java.util.List.of();
        return store.values().stream()
                .filter(fp -> repositoryFullName.equalsIgnoreCase(fp.getRepositoryFullName()))
                .toList();
    }

    @Override
    public LogFingerprint save(LogFingerprint logFingerprint) {
        if (logFingerprint == null || logFingerprint.getHash() == null) {
            throw new IllegalArgumentException("LogFingerprint or its hash cannot be null");
        }
        store.put(logFingerprint.getHash(), logFingerprint);
        return logFingerprint;
    }
}
