package com.yourssu.pikiland.infrastructure.github;

import com.yourssu.pikiland.domain.port.GithubAuthPort;
import com.yourssu.pikiland.domain.port.SystemSettingsRepository;
import com.yourssu.pikiland.domain.model.SystemSettings;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Component
public class GithubAppAuthenticator implements GithubAuthPort {

    private final String appId;
    private final String privateKeyPath;

    /** Default RestTemplate: follows redirects (used for most API calls). */
    private final RestTemplate restTemplate;

    /**
     * No-redirect RestTemplate used exclusively for the workflow-log download.
     * GitHub's /logs endpoint returns 302 → AWS S3 presigned URL.
     * S3 presigned URLs embed their own auth in query params; forwarding the
     * GitHub Authorization header to S3 causes an AWS SignatureDoesNotMatch error.
     * By disabling auto-follow we can strip the header before fetching from S3.
     */
    private final RestTemplate noRedirectRestTemplate;
    private final SystemSettingsRepository systemSettingsRepository;

    public GithubAppAuthenticator(
            @Value("${app.github.app-id:}") String appId,
            @Value("${app.github.private-key-path:github-app-private-key.pem}") String privateKeyPath,
            SystemSettingsRepository systemSettingsRepository) {
        this.appId = appId;
        this.privateKeyPath = privateKeyPath;
        this.systemSettingsRepository = systemSettingsRepository;
        
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);
        factory.setReadTimeout(60000);
        this.restTemplate = new RestTemplate(factory);

        SimpleClientHttpRequestFactory noRedirectFactory = new SimpleClientHttpRequestFactory() {
            @Override
            protected void prepareConnection(java.net.HttpURLConnection connection, String httpMethod) throws java.io.IOException {
                super.prepareConnection(connection, httpMethod);
                connection.setInstanceFollowRedirects(false);
            }
        };
        noRedirectFactory.setConnectTimeout(10000);
        noRedirectFactory.setReadTimeout(60000);
        this.noRedirectRestTemplate = new RestTemplate(noRedirectFactory);
    }

    private PrivateKey getPrivateKey() throws Exception {
        String keyContent = null;
        if (systemSettingsRepository != null) {
            Optional<SystemSettings> sysOpt = systemSettingsRepository.findGlobalSettings();
            if (sysOpt.isPresent() && sysOpt.get().getGithubPrivateKeyContent() != null && !sysOpt.get().getGithubPrivateKeyContent().isBlank()) {
                keyContent = sysOpt.get().getGithubPrivateKeyContent();
            }
        }
        if (keyContent == null) {
            byte[] keyBytes = Files.readAllBytes(Paths.get(privateKeyPath));
            keyContent = new String(keyBytes, StandardCharsets.UTF_8);
        }

        String temp = keyContent
                .replaceAll("-----BEGIN PRIVATE KEY-----", "")
                .replaceAll("-----END PRIVATE KEY-----", "")
                .replaceAll("-----BEGIN RSA PRIVATE KEY-----", "")
                .replaceAll("-----END RSA PRIVATE KEY-----", "")
                .replaceAll("\\s+", "");
        byte[] decode = Base64.getDecoder().decode(temp);
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(decode);
        KeyFactory kf = KeyFactory.getInstance("RSA");
        return kf.generatePrivate(spec);
    }

    private String getEffectiveAppId() {
        if (systemSettingsRepository != null) {
            Optional<SystemSettings> sysOpt = systemSettingsRepository.findGlobalSettings();
            if (sysOpt.isPresent() && sysOpt.get().getGithubAppId() != null && !sysOpt.get().getGithubAppId().isBlank()) {
                return sysOpt.get().getGithubAppId();
            }
        }
        return appId;
    }

    private String generateJwt() {
        try {
            PrivateKey privateKey = getPrivateKey();
            return Jwts.builder()
                    .issuedAt(new Date(System.currentTimeMillis() - 60000))
                    .expiration(new Date(System.currentTimeMillis() + 600000))
                    .issuer(getEffectiveAppId())
                    .signWith(privateKey, Jwts.SIG.RS256)
                    .compact();
        } catch (Exception e) {
            throw new RuntimeException("Failed to generate JWT for GitHub App", e);
        }
    }

    @Override
    public String getInstallationAccessToken(long installationId) {
        String jwt = generateJwt();
        String url = "https://api.github.com/app/installations/" + installationId + "/access_tokens";

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + jwt);
            headers.set("Accept", "application/vnd.github+json");

            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.CREATED && response.getBody() != null) {
                return (String) response.getBody().get("token");
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to fetch Installation Access Token for installation " + installationId, e);
        }
        throw new RuntimeException("Failed to acquire token: Empty response.");
    }

    @Override
    public String createPullRequest(String repo, String title, String body, String headBranch, String baseBranch, String token) {
        String url = "https://api.github.com/repos/" + repo + "/pulls";
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + token);
            headers.set("Accept", "application/vnd.github+json");
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, String> payload = new HashMap<>();
            payload.put("title", title);
            payload.put("body", body);
            payload.put("head", headBranch);
            payload.put("base", baseBranch);

            HttpEntity<Map<String, String>> entity = new HttpEntity<>(payload, headers);
            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.CREATED && response.getBody() != null) {
                return (String) response.getBody().get("html_url");
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to create Pull Request for repo " + repo, e);
        }
        return null;
    }

    @Override
    public String downloadWorkflowLogs(String repo, String runId, String token) {
        String url = "https://api.github.com/repos/" + repo + "/actions/runs/" + runId + "/logs";
        try {
            HttpHeaders githubHeaders = new HttpHeaders();
            githubHeaders.set("Authorization", "Bearer " + token);
            githubHeaders.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> githubEntity = new HttpEntity<>(githubHeaders);

            // Step 1: call GitHub API — expect 302 redirect to an S3 presigned URL.
            // We use noRedirectRestTemplate so Spring doesn't auto-follow the redirect
            // and accidentally forward the Authorization header to S3 (causing SignatureDoesNotMatch).
            ResponseEntity<byte[]> initialResponse;
            try {
                initialResponse = noRedirectRestTemplate.exchange(url, HttpMethod.GET, githubEntity, byte[].class);
            } catch (Exception ex) {
                // Some RestTemplate builds throw on non-2xx; try to extract Location from exception or re-throw
                throw new RuntimeException("Initial GitHub logs request failed", ex);
            }

            byte[] zipBytes = null;

            if (initialResponse.getStatusCode() == HttpStatus.OK && initialResponse.getBody() != null) {
                // Rare: API returned the ZIP directly (e.g. test doubles or future API change)
                zipBytes = initialResponse.getBody();
            } else if (initialResponse.getStatusCode().is3xxRedirection()) {
                // Step 2: follow the redirect to S3 — WITHOUT the Authorization header
                String s3Url = initialResponse.getHeaders().getFirst(HttpHeaders.LOCATION);
                if (s3Url == null || s3Url.isBlank()) {
                    throw new RuntimeException("GitHub returned 302 but no Location header for run " + runId);
                }
                System.out.println("[GitHub] Following log redirect to S3 (auth header stripped): " + s3Url.substring(0, Math.min(80, s3Url.length())) + "...");
                ResponseEntity<byte[]> s3Response = restTemplate.exchange(
                        s3Url, HttpMethod.GET, new HttpEntity<>(new HttpHeaders()), byte[].class);
                if (s3Response.getStatusCode() == HttpStatus.OK && s3Response.getBody() != null) {
                    zipBytes = s3Response.getBody();
                } else {
                    throw new RuntimeException("S3 log download failed: " + s3Response.getStatusCode());
                }
            } else {
                throw new RuntimeException("Unexpected response from GitHub logs endpoint: " + initialResponse.getStatusCode());
            }

            // Step 3: unzip and concatenate all .txt log files with Zip Bomb protection
            StringBuilder logBuilder = new StringBuilder();
            long totalBytes = 0;
            int entryCount = 0;
            long maxBytes = 50 * 1024 * 1024; // 50MB
            int maxEntries = 500;

            try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
                ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    entryCount++;
                    if (entryCount > maxEntries) {
                        System.err.println("[Zip Guard] Exceeded max allowed entries limit (" + maxEntries + "). Truncating log unzipping.");
                        break;
                    }

                    if (entry.getName().endsWith(".txt") || !entry.getName().contains("/")) {
                        BufferedReader br = new BufferedReader(new InputStreamReader(zis, StandardCharsets.UTF_8));
                        String line;
                        logBuilder.append("=== File: ").append(entry.getName()).append(" ===\n");
                        while ((line = br.readLine()) != null) {
                            totalBytes += line.getBytes(StandardCharsets.UTF_8).length;
                            if (totalBytes > maxBytes) {
                                System.err.println("[Zip Guard] Exceeded max allowed size limit (50MB). Truncating log unzipping.");
                                logBuilder.append("\n... [Log Truncated - Reached maximum allowed 50MB uncompressed limit] ...\n");
                                return logBuilder.toString();
                            }
                            logBuilder.append(line).append("\n");
                        }
                        logBuilder.append("\n");
                    }
                }
            }
            return logBuilder.toString();

        } catch (Exception e) {
            throw new RuntimeException("Failed to download workflow logs for run " + runId, e);
        }
    }

    @Override
    public String fetchIssueBody(String repo, String issueNumber, String token) {
        String url = "https://api.github.com/repos/" + repo + "/issues/" + issueNumber;
        try {
            HttpHeaders headers = new HttpHeaders();
            if (token != null && !token.isBlank()) {
                headers.set("Authorization", "Bearer " + token);
            }
            headers.set("Accept", "application/vnd.github+json");
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, entity, Map.class);
            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                String body = (String) response.getBody().get("body");
                String title = (String) response.getBody().get("title");
                return "Issue #" + issueNumber + " Title: " + (title != null ? title : "") + "\n\n" + (body != null ? body : "");
            }
        } catch (Exception e) {
            System.err.println("Failed to fetch issue body for issue #" + issueNumber + " in " + repo + ": " + e.getMessage());
        }
        return "";
    }

    @Override
    public void triggerWorkflowDispatch(String repo, String workflowId, String ref, Map<String, Object> inputs, String token) {
        String url = "https://api.github.com/repos/" + repo + "/actions/workflows/" + workflowId + "/dispatches";
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + token);
            headers.set("Accept", "application/vnd.github+json");
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, Object> payload = new HashMap<>();
            payload.put("ref", ref);
            payload.put("inputs", inputs);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(payload, headers);
            restTemplate.postForEntity(url, entity, Void.class);
            System.out.println("Successfully triggered workflow dispatch '" + workflowId + "' on ref " + ref + " for repo " + repo);
        } catch (Exception e) {
            throw new RuntimeException("Failed to trigger Workflow Dispatch for repo " + repo, e);
        }
    }

    @Override
    public void installWorkflowIfMissing(String repo, String token, String defaultBranch) {
        String path = ".github/workflows/pikiland.yml";
        String checkUrl = "https://api.github.com/repos/" + repo + "/contents/" + path + "?ref=" + defaultBranch;

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + token);
            headers.set("Accept", "application/vnd.github+json");

            HttpEntity<Void> entity = new HttpEntity<>(headers);
            try {
                ResponseEntity<Map> response = restTemplate.exchange(checkUrl, HttpMethod.GET, entity, Map.class);
                if (response.getStatusCode() == HttpStatus.OK) {
                    System.out.println("[GitHub] pikiland.yml already exists in " + repo);
                    return;
                }
            } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
                // File missing, install it
                System.out.println("[GitHub] pikiland.yml not found in " + repo + ". Installing...");
                String installUrl = "https://api.github.com/repos/" + repo + "/contents/" + path;

                String yaml = "name: PikiLand Self-Healing\n" +
                        "\n" +
                        "on:\n" +
                        "  workflow_dispatch:\n" +
                        "    inputs:\n" +
                        "      event_type:\n" +
                        "        description: 'Original event type'\n" +
                        "        required: true\n" +
                        "      log_content:\n" +
                        "        description: 'Truncated error log or issue body (Optional - CLI downloads via run_id if omitted)'\n" +
                        "        required: false\n" +
                        "      run_id:\n" +
                        "        description: 'Original run ID or issue number'\n" +
                        "        required: true\n" +
                        "      target_branch:\n" +
                        "        description: 'Branch to checkout and patch'\n" +
                        "        required: true\n" +
                        "      slack_webhook_url:\n" +
                        "        description: 'Slack Webhook URL'\n" +
                        "        required: false\n" +
                        "      ai_model:\n" +
                        "        description: 'AI model name'\n" +
                        "        required: false\n" +
                        "      ai_base_url:\n" +
                        "        description: 'Custom AI API Base URL'\n" +
                        "        required: false\n" +
                        "      harness_cmd:\n" +
                        "        description: 'Command to run harness verification (e.g. ./gradlew test)'\n" +
                        "        required: false\n" +
                        "\n" +
                        "jobs:\n" +
                        "  pikiland-patch:\n" +
                        "    runs-on: ubuntu-latest\n" +
                        "    steps:\n" +
                        "      - name: Checkout Code\n" +
                        "        uses: actions/checkout@v4\n" +
                        "        with:\n" +
                        "          ref: ${{ github.event.inputs.target_branch }}\n" +
                        "          fetch-depth: 0\n" +
                        "\n" +
                        "      - name: Set up Java 21\n" +
                        "        uses: actions/setup-java@v4\n" +
                        "        with:\n" +
                        "          java-version: '21'\n" +
                        "          distribution: 'temurin'\n" +
                        "\n" +
                        "      - name: Run PikiLand CLI (Native Execution)\n" +
                        "        env:\n" +
                        "          PIKILAND_CLI: \"true\"\n" +
                        "          PIKILAND_EVENT_TYPE: \"${{ github.event.inputs.event_type }}\"\n" +
                        "          PIKILAND_LOG_CONTENT: \"${{ github.event.inputs.log_content }}\"\n" +
                        "          PIKILAND_RUN_ID: \"${{ github.event.inputs.run_id }}\"\n" +
                        "          PIKILAND_TARGET_BRANCH: \"${{ github.event.inputs.target_branch }}\"\n" +
                        "          PIKILAND_WORKSPACE_PATH: \".\"\n" +
                        "          PIKILAND_HARNESS_CMD: \"${{ github.event.inputs.harness_cmd }}\"\n" +
                        "          GITHUB_TOKEN: \"${{ secrets.GITHUB_TOKEN }}\"\n" +
                        "          GITHUB_REPOSITORY: \"${{ github.repository }}\"\n" +
                        "          SLACK_WEBHOOK_URL: \"${{ github.event.inputs.slack_webhook_url }}\"\n" +
                        "          AI_MODEL: \"${{ github.event.inputs.ai_model }}\"\n" +
                        "          PIKILAND_AI_BASE_URL: \"${{ github.event.inputs.ai_base_url }}\"\n" +
                        "          OPENAI_BASE_URL: \"${{ github.event.inputs.ai_base_url }}\"\n" +
                        "          ANTHROPIC_BASE_URL: \"${{ github.event.inputs.ai_base_url }}\"\n" +
                        "          OPENAI_API_KEY: \"${{ secrets.OPENAI_API_KEY || secrets.PIKILAND_AI_API_KEY }}\"\n" +
                        "          ANTHROPIC_API_KEY: \"${{ secrets.ANTHROPIC_API_KEY || secrets.PIKILAND_AI_API_KEY }}\"\n" +
                        "        run: |\n" +
                        "          chmod +x gradlew\n" +
                        "          ./gradlew bootRun --args=\"--cli\"\n";

                String base64Content = Base64.getEncoder().encodeToString(yaml.getBytes(StandardCharsets.UTF_8));

                Map<String, Object> body = new HashMap<>();
                body.put("message", "ci: install PikiLand self-healing workflow");
                body.put("content", base64Content);
                body.put("branch", defaultBranch);

                HttpHeaders putHeaders = new HttpHeaders();
                putHeaders.set("Authorization", "Bearer " + token);
                putHeaders.set("Accept", "application/vnd.github+json");
                putHeaders.setContentType(MediaType.APPLICATION_JSON);

                HttpEntity<Map<String, Object>> putEntity = new HttpEntity<>(body, putHeaders);
                restTemplate.exchange(installUrl, HttpMethod.PUT, putEntity, Map.class);
                System.out.println("[GitHub] Successfully installed pikiland.yml in " + repo + " on branch " + defaultBranch);
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to check/install workflow file in " + repo, e);
        }
    }
}
