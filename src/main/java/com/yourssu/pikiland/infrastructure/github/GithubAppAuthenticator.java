package com.yourssu.pikiland.infrastructure.github;

import com.yourssu.pikiland.domain.port.GithubAuthPort;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
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
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Component
public class GithubAppAuthenticator implements GithubAuthPort {

    private final String appId;
    private final String privateKeyPath;
    private final RestTemplate restTemplate;

    public GithubAppAuthenticator(
            @Value("${app.github.app-id:}") String appId,
            @Value("${app.github.private-key-path:github-app-private-key.pem}") String privateKeyPath) {
        this.appId = appId;
        this.privateKeyPath = privateKeyPath;
        this.restTemplate = new RestTemplate();
    }

    private PrivateKey getPrivateKey() throws Exception {
        byte[] keyBytes = Files.readAllBytes(Paths.get(privateKeyPath));
        String temp = new String(keyBytes, StandardCharsets.UTF_8)
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

    private String generateJwt() {
        try {
            PrivateKey privateKey = getPrivateKey();
            return Jwts.builder()
                    .issuedAt(new Date(System.currentTimeMillis() - 60000))
                    .expiration(new Date(System.currentTimeMillis() + 600000))
                    .issuer(appId)
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
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + token);
            headers.set("Accept", "application/vnd.github+json");
            
            HttpEntity<Void> entity = new HttpEntity<>(headers);
            ResponseEntity<byte[]> response = restTemplate.exchange(url, HttpMethod.GET, entity, byte[].class);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                StringBuilder logBuilder = new StringBuilder();
                try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(response.getBody()))) {
                    ZipEntry entry;
                    while ((entry = zis.getNextEntry()) != null) {
                        if (entry.getName().endsWith(".txt") || !entry.getName().contains("/")) {
                            BufferedReader br = new BufferedReader(new InputStreamReader(zis, StandardCharsets.UTF_8));
                            String line;
                            logBuilder.append("=== File: ").append(entry.getName()).append(" ===\n");
                            while ((line = br.readLine()) != null) {
                                logBuilder.append(line).append("\n");
                            }
                            logBuilder.append("\n");
                        }
                    }
                }
                return logBuilder.toString();
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to download workflow logs for run " + runId, e);
        }
        return "No logs downloaded.";
    }
}
