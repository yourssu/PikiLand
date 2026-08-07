package com.yourssu.pikiland.domain.model;

import java.time.LocalDateTime;

@SuppressWarnings("unused")
public class LogFingerprint {
    public enum State { IN_PROGRESS, PR_CREATED, RESOLVED, FAILED }

    private final String hash;
    private final String repositoryFullName;
    private final String normalizedSignature;
    private final String rawLog;
    private State state;
    private int occurrenceCount;
    private String prUrl;
    private final LocalDateTime firstSeenAt;
    private LocalDateTime lastSeenAt;

    public LogFingerprint(String hash, String repositoryFullName, String normalizedSignature, String rawLog) {
        if (hash == null || hash.isBlank()) {
            throw new IllegalArgumentException("Hash cannot be null or blank");
        }
        this.hash = hash;
        this.repositoryFullName = repositoryFullName != null ? repositoryFullName : "";
        this.normalizedSignature = normalizedSignature != null ? normalizedSignature : "";
        this.rawLog = rawLog != null ? rawLog : "";
        this.state = State.IN_PROGRESS;
        this.occurrenceCount = 1;
        this.firstSeenAt = LocalDateTime.now();
        this.lastSeenAt = LocalDateTime.now();
    }

    public LogFingerprint(String hash, String repositoryFullName, String normalizedSignature) {
        this(hash, repositoryFullName, normalizedSignature, normalizedSignature);
    }

    public void incrementOccurrence() {
        this.occurrenceCount++;
        this.lastSeenAt = LocalDateTime.now();
    }

    public void markPrCreated(String prUrl) {
        this.state = State.PR_CREATED;
        this.prUrl = prUrl;
        this.lastSeenAt = LocalDateTime.now();
    }

    public void markResolved() {
        this.state = State.RESOLVED;
        this.lastSeenAt = LocalDateTime.now();
    }

    public void markFailed() {
        this.state = State.FAILED;
        this.lastSeenAt = LocalDateTime.now();
    }

    public String getPrUrl() {
        return prUrl;
    }

    public String getHash() {
        return hash;
    }

    public String getRepositoryFullName() {
        return repositoryFullName;
    }

    public String getNormalizedSignature() {
        return normalizedSignature;
    }

    public String getRawLog() {
        return rawLog;
    }

    public State getState() {
        return state;
    }

    public int getOccurrenceCount() {
        return occurrenceCount;
    }

    public LocalDateTime getFirstSeenAt() {
        return firstSeenAt;
    }

    public LocalDateTime getLastSeenAt() {
        return lastSeenAt;
    }
}
