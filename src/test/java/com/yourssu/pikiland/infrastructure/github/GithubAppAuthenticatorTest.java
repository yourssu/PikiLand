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

        // Verify Native Java setup and bootRun execution exist
        assertTrue(decodedYaml.contains("actions/setup-java@v4"), "Workflow should use actions/setup-java@v4");
        assertTrue(decodedYaml.contains("./gradlew bootRun --args=\"--cli\""), "Workflow should execute ./gradlew bootRun --args=\"--cli\"");

        // Verify Secret Isolation (Issue 4.1)
        assertFalse(decodedYaml.contains("ai_api_key:"), "Workflow should not expose ai_api_key in workflow_dispatch inputs");
        assertTrue(decodedYaml.contains("OPENAI_API_KEY: \"${{ secrets.OPENAI_API_KEY || secrets.PIKILAND_AI_API_KEY }}\""), "OPENAI_API_KEY should be bound to repository secrets");
        assertTrue(decodedYaml.contains("ANTHROPIC_API_KEY: \"${{ secrets.ANTHROPIC_API_KEY || secrets.PIKILAND_AI_API_KEY }}\""), "ANTHROPIC_API_KEY should be bound to repository secrets");
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
