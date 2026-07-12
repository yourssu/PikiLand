package com.yourssu.pikiland.domain.port;

public interface GithubAuthPort {
    String getInstallationAccessToken(long installationId);
    String createPullRequest(String repo, String title, String body, String headBranch, String baseBranch, String token);
    String downloadWorkflowLogs(String repo, String runId, String token);
}
