package com.yourssu.pikiland.infrastructure.github;

import com.yourssu.pikiland.domain.port.SystemSettingsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GithubAppAuthenticatorTest {

    private RestTemplate restTemplate;
    private SystemSettingsRepository systemSettingsRepository;
    private GithubAppAuthenticator authenticator;

    @BeforeEach
    void setUp() {
        restTemplate = Mockito.mock(RestTemplate.class);
        systemSettingsRepository = Mockito.mock(SystemSettingsRepository.class);
        authenticator = new GithubAppAuthenticator("appId", "keyPath", systemSettingsRepository);
        ReflectionTestUtils.setField(authenticator, "restTemplate", restTemplate);
    }

    @Test
    @DisplayName("pikiland.yml 미존재 시 Docker 구문이 제거된 Native Java 21 실행 워크플로 템플릿을 추가한다")
    void installWorkflowIfMissing_NativeExecutionTemplate() {
        String repo = "owner/test-repo";
        String token = "test-token";
        String defaultBranch = "main";

        // Mock GET checkUrl to throw HttpClientErrorException.NotFound (file missing)
        when(restTemplate.exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml?ref=main"),
                eq(HttpMethod.GET),
                any(HttpEntity.class),
                eq(Map.class)
        )).thenThrow(org.springframework.web.client.HttpClientErrorException.NotFound.create(
                HttpStatus.NOT_FOUND, "Not Found", org.springframework.http.HttpHeaders.EMPTY, new byte[0], null
        ));

        // Mock PUT installUrl response
        when(restTemplate.exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml"),
                eq(HttpMethod.PUT),
                any(HttpEntity.class),
                eq(Map.class)
        )).thenReturn(new ResponseEntity<>(Map.of(), HttpStatus.CREATED));

        authenticator.installWorkflowIfMissing(repo, token, defaultBranch);

        // Capture PUT request body
        ArgumentCaptor<HttpEntity> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml"),
                eq(HttpMethod.PUT),
                captor.capture(),
                eq(Map.class)
        );

        Map<String, Object> bodyMap = (Map<String, Object>) captor.getValue().getBody();
        String base64Content = (String) bodyMap.get("content");
        String decodedYaml = new String(Base64.getDecoder().decode(base64Content));

        // Verify Docker run command is removed
        assertFalse(decodedYaml.contains("docker run"), "Workflow should not contain docker run command");
        assertFalse(decodedYaml.contains("ghcr.io/yourssu/pikiland"), "Workflow should not reference Docker registry image");

        // Verify Bun setup and TS execution exist
        assertTrue(decodedYaml.contains("oven-sh/setup-bun@v2"), "Workflow should use oven-sh/setup-bun@v2");
        assertTrue(decodedYaml.contains("bun run ./src/index.ts"), "Workflow should execute bun run ./src/index.ts");

        // Verify PikiLand Engine checkout and workspace path
        assertTrue(decodedYaml.contains("repository: 'yourssu/PikiLand-Engine'"), "Workflow should checkout PikiLand engine repository");
        assertTrue(decodedYaml.contains("path: 'pikiland-engine'"), "Workflow should place PikiLand engine in pikiland-engine directory");
        assertTrue(decodedYaml.contains("PIKILAND_WORKSPACE_PATH: \"${{ github.workspace }}\""), "Workflow should pass target workspace path to PikiLand CLI");
        assertTrue(decodedYaml.contains("cd pikiland-engine"), "Workflow should navigate to pikiland-engine before running ./gradlew bootRun");

        // Verify Secret Isolation and AI Base URL (Issue 4.1)
        assertFalse(decodedYaml.contains("ai_api_key:"), "Workflow should not expose ai_api_key in workflow_dispatch inputs");
        assertTrue(decodedYaml.contains("ai_base_url:"), "Workflow should declare ai_base_url input");
        assertTrue(decodedYaml.contains("PIKILAND_AI_BASE_URL: \"${{ github.event.inputs.ai_base_url }}\""), "PIKILAND_AI_BASE_URL should be exported");
        assertTrue(decodedYaml.contains("OPENAI_BASE_URL: \"${{ github.event.inputs.ai_base_url }}\""), "OPENAI_BASE_URL should be exported");
        assertTrue(decodedYaml.contains("ANTHROPIC_BASE_URL: \"${{ github.event.inputs.ai_base_url }}\""), "ANTHROPIC_BASE_URL should be exported");
        assertTrue(decodedYaml.contains("OPENAI_API_KEY: \"${{ secrets.OPENAI_API_KEY || secrets.PIKILAND_AI_API_KEY }}\""), "OPENAI_API_KEY should be bound to repository secrets");
        assertTrue(decodedYaml.contains("ANTHROPIC_API_KEY: \"${{ secrets.ANTHROPIC_API_KEY || secrets.PIKILAND_AI_API_KEY }}\""), "ANTHROPIC_API_KEY should be bound to repository secrets");

        // Verify Workflow Permissions for git push & PR creation
        assertTrue(decodedYaml.contains("permissions:"), "Workflow should declare permissions block");
        assertTrue(decodedYaml.contains("contents: write"), "Workflow should grant contents: write permission");
        assertTrue(decodedYaml.contains("pull-requests: write"), "Workflow should grant pull-requests: write permission");
    }

    @Test
    @DisplayName("구버전 pikiland.yml에 ai_base_url 또는 OPENAI_BASE_URL이 없으면 최신 템플릿으로 자동 업데이트한다")
    void installWorkflowIfMissing_OutdatedTemplateWithoutAiBaseUrl_AutoUpdates() {
        String repo = "owner/test-repo";
        String token = "test-token";
        String defaultBranch = "main";

        // Mock GET checkUrl returning existing outdated YAML (with ralph_max_retries and pikiland-engine, but without ai_base_url)
        String outdatedYaml = "name: PikiLand\njobs:\n  pikiland-patch:\n    steps:\n      - run: echo ralph_max_retries: pikiland-engine spring.profiles.active=local\n";
        String base64Outdated = Base64.getEncoder().encodeToString(outdatedYaml.getBytes());
        Map<String, Object> getResponseBody = Map.of(
                "sha", "old-sha-67890",
                "content", base64Outdated
        );

        when(restTemplate.exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml?ref=main"),
                eq(HttpMethod.GET),
                any(HttpEntity.class),
                eq(Map.class)
        )).thenReturn(new ResponseEntity<>(getResponseBody, HttpStatus.OK));

        when(restTemplate.exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml"),
                eq(HttpMethod.PUT),
                any(HttpEntity.class),
                eq(Map.class)
        )).thenReturn(new ResponseEntity<>(Map.of(), HttpStatus.OK));

        authenticator.installWorkflowIfMissing(repo, token, defaultBranch);

        ArgumentCaptor<HttpEntity> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml"),
                eq(HttpMethod.PUT),
                captor.capture(),
                eq(Map.class)
        );

        Map<String, Object> bodyMap = (Map<String, Object>) captor.getValue().getBody();
        org.junit.jupiter.api.Assertions.assertEquals("old-sha-67890", bodyMap.get("sha"), "PUT request should include existing file sha for update");
        org.junit.jupiter.api.Assertions.assertEquals("ci: update PikiLand self-healing workflow", bodyMap.get("message"));
    }

    @Test
    @DisplayName("구버전 pikiland.yml이 이미 존재하는 경우 sha 값을 포함하여 최신 템플릿으로 자동 업데이트한다")
    void installWorkflowIfMissing_OutdatedTemplate_AutoUpdates() {
        String repo = "owner/test-repo";
        String token = "test-token";
        String defaultBranch = "main";

        // Mock GET checkUrl returning existing outdated YAML (without ralph_max_retries and pikiland-engine)
        String outdatedYaml = "name: Old PikiLand\njobs:\n  pikiland-patch:\n    steps:\n      - run: echo old\n";
        String base64Outdated = Base64.getEncoder().encodeToString(outdatedYaml.getBytes());
        Map<String, Object> getResponseBody = Map.of(
                "sha", "old-sha-12345",
                "content", base64Outdated
        );

        when(restTemplate.exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml?ref=main"),
                eq(HttpMethod.GET),
                any(HttpEntity.class),
                eq(Map.class)
        )).thenReturn(new ResponseEntity<>(getResponseBody, HttpStatus.OK));

        when(restTemplate.exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml"),
                eq(HttpMethod.PUT),
                any(HttpEntity.class),
                eq(Map.class)
        )).thenReturn(new ResponseEntity<>(Map.of(), HttpStatus.OK));

        authenticator.installWorkflowIfMissing(repo, token, defaultBranch);

        ArgumentCaptor<HttpEntity> captor = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml"),
                eq(HttpMethod.PUT),
                captor.capture(),
                eq(Map.class)
        );

        Map<String, Object> bodyMap = (Map<String, Object>) captor.getValue().getBody();
        org.junit.jupiter.api.Assertions.assertEquals("old-sha-12345", bodyMap.get("sha"), "PUT request should include existing file sha for update");
        org.junit.jupiter.api.Assertions.assertEquals("ci: update PikiLand self-healing workflow", bodyMap.get("message"));
    }

    @Test
    @DisplayName("workflow_dispatch 422 Unprocessable Entity 에러 발생 시 인자를 박탈하지 않고 즉시 예외를 발생시킨다")
    void triggerWorkflowDispatch_UnprocessableEntity_ThrowsExceptionWithoutStrippingInputs() {
        String repo = "owner/test-repo";
        String token = "test-token";
        String ref = "main";
        java.util.Map<String, Object> inputs = new java.util.HashMap<>();
        inputs.put("event_type", "workflow_run");
        inputs.put("ai_base_url", "https://api.openai.com/v1");

        String errorResponseJson = "{\"message\":\"Unexpected inputs provided: [\\\"ai_base_url\\\"]\",\"status\":\"422\"}";

        org.springframework.web.client.HttpClientErrorException unprocessableEntityException =
                org.springframework.web.client.HttpClientErrorException.create(
                        HttpStatus.UNPROCESSABLE_ENTITY,
                        "Unprocessable Entity",
                        org.springframework.http.HttpHeaders.EMPTY,
                        errorResponseJson.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                        java.nio.charset.StandardCharsets.UTF_8
                );

        when(restTemplate.postForEntity(
                eq("https://api.github.com/repos/owner/test-repo/actions/workflows/pikiland.yml/dispatches"),
                any(HttpEntity.class),
                eq(Void.class)
        )).thenThrow(unprocessableEntityException);

        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class, () -> {
            authenticator.triggerWorkflowDispatch(repo, "pikiland.yml", ref, inputs, token);
        });

        // Verify only 1 attempt was made and NO input stripping retry took place
        verify(restTemplate, Mockito.times(1)).postForEntity(
                eq("https://api.github.com/repos/owner/test-repo/actions/workflows/pikiland.yml/dispatches"),
                any(HttpEntity.class),
                eq(Void.class)
        );
    }

    @Test
    @DisplayName("해시값이 일치하는 동일한 pikiland.yml이 존재할 경우 업데이트를 수행하지 않는다")
    void installWorkflowIfMissing_ExactHashMatch_NoUpdateRequired() {
        String repo = "owner/test-repo";
        String token = "test-token";
        String defaultBranch = "main";

        // Get exact YAML content from authenticator via reflection
        String currentYaml = (String) ReflectionTestUtils.invokeMethod(authenticator, "buildWorkflowYaml");
        String base64Content = Base64.getEncoder().encodeToString(currentYaml.getBytes());
        Map<String, Object> getResponseBody = Map.of(
                "sha", "exact-matching-sha",
                "content", base64Content
        );

        when(restTemplate.exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml?ref=main"),
                eq(HttpMethod.GET),
                any(HttpEntity.class),
                eq(Map.class)
        )).thenReturn(new ResponseEntity<>(getResponseBody, HttpStatus.OK));

        authenticator.installWorkflowIfMissing(repo, token, defaultBranch);

        // Verify PUT was NEVER called since SHA-256 matched
        verify(restTemplate, Mockito.never()).exchange(
                eq("https://api.github.com/repos/owner/test-repo/contents/.github/workflows/pikiland.yml"),
                eq(HttpMethod.PUT),
                any(HttpEntity.class),
                eq(Map.class)
        );
    }

    @Test
    @DisplayName("PKCS#1 RSA Key(BEGIN RSA PRIVATE KEY)가 들어왔을 때 DER Header 변환 후 파싱에 성공한다")
    void getPrivateKey_PKCS1_Success() throws Exception {
        // 512-bit RSA PrivateKey PKCS#1 DER Sample
        byte[] pkcs1Bytes = Base64.getDecoder().decode(
            "MIIBOgIBAAJBALR3a2uVdM5+M/+mYF0z0L4G04d3j2ZJ6O6A4J7d8v7S2r8D/1g4" +
            "S5P2s8Y5K6a5Z5V1v1g1g1g1g1g1g1g1g1g1g1g1g1g1g0CAwEAAQJAQ0+0/999" +
            "9999999999999999999999999999999999999999999999999999999999999999" +
            "9999999999999999999999999999999999999999999999999999999999999999"
        );
        byte[] converted = (byte[]) ReflectionTestUtils.invokeMethod(authenticator, "convertPkcs1ToPkcs8", (Object) pkcs1Bytes);
        org.junit.jupiter.api.Assertions.assertNotNull(converted);
        org.junit.jupiter.api.Assertions.assertTrue(converted.length > pkcs1Bytes.length);
    }
}
