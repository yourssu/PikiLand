package com.yourssu.pikiland;

import com.yourssu.pikiland.application.service.SelfHealingAppService;
import com.yourssu.pikiland.domain.model.AiAnalysisResult;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.GithubAuthPort;
import com.yourssu.pikiland.domain.port.NotifierPort;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import com.yourssu.pikiland.domain.port.WorkspacePort;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.*;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("local")
public class DryRunTest {

    @Autowired
    private SelfHealingAppService selfHealingAppService;

    @Autowired
    private RepoSettingsRepository settingsRepository;

    @SpyBean
    private WorkspacePort workspacePort;

    @MockBean
    private RestTemplate restTemplate;

    @MockBean
    private GithubAuthPort githubAuthPort;

    @MockBean
    private NotifierPort notifierPort;

    @Test
    public void testDryRunSelfHealingLoop() throws Exception {
        // 1. Setup a Mock User Workspace with a bug
        Path mockWorkspace = Files.createTempDirectory("pikiland-dryrun-");
        Path srcDir = mockWorkspace.resolve("src/main/java");
        Files.createDirectories(srcDir);
        
        Path badFile = srcDir.resolve("App.java");
        String badCode = "public class App {\n" +
                "    public static void main(String[] args) {\n" +
                "        System.out.println(undeclaredVar);\n" +
                "    }\n" +
                "}";
        Files.writeString(badFile, badCode);

        // 2. Persist mock settings in database
        settingsRepository.save(new RepoSettings(
                "test-owner/test-repo",
                true,
                "https://hooks.slack.com/services/mock-webhook-url",
                "gpt-4o"
        ));

        // 3. Setup Mocks and Spy
        doReturn(mockWorkspace).when(workspacePort).cloneRepository(anyString(), anyString());
        doNothing().when(workspacePort).commitAndPush(any(Path.class), anyString(), anyString(), anyString(), anyString());
        
        when(githubAuthPort.getInstallationAccessToken(anyLong())).thenReturn("mock-token");
        when(githubAuthPort.downloadWorkflowLogs(anyString(), anyString(), anyString())).thenReturn("Build Failed. Symbol undeclaredVar not found.");

        // AI loop mock steps:
        // Step 1: Request list directory in src/main/java
        String resStep1 = "{\n" +
                "  \"choices\": [{\n" +
                "    \"message\": {\n" +
                "      \"role\": \"assistant\",\n" +
                "      \"content\": \"I will list the directory to find files.\",\n" +
                "      \"tool_calls\": [{\n" +
                "        \"id\": \"call_1\",\n" +
                "        \"type\": \"function\",\n" +
                "        \"function\": {\n" +
                "          \"name\": \"list_directory\",\n" +
                "          \"arguments\": \"{\\\"directory_path\\\": \\\"src/main/java\\\"}\"\n" +
                "        }\n" +
                "      }]\n" +
                "    }\n" +
                "  }]\n" +
                "}";

        // Step 2: Request read App.java
        String resStep2 = "{\n" +
                "  \"choices\": [{\n" +
                "    \"message\": {\n" +
                "      \"role\": \"assistant\",\n" +
                "      \"content\": \"I will read the contents of App.java.\",\n" +
                "      \"tool_calls\": [{\n" +
                "        \"id\": \"call_2\",\n" +
                "        \"type\": \"function\",\n" +
                "        \"function\": {\n" +
                "          \"name\": \"read_file_content\",\n" +
                "          \"arguments\": \"{\\\"file_path\\\": \\\"src/main/java/App.java\\\"}\"\n" +
                "        }\n" +
                "      }]\n" +
                "    }\n" +
                "  }]\n" +
                "}";

        // Step 3: Returns structural analysis and patch details
        String resStep3 = "{\n" +
                "  \"choices\": [{\n" +
                "    \"message\": {\n" +
                "      \"role\": \"assistant\",\n" +
                "      \"content\": \"{\\\"is_confident\\\": true, \\\"summary\\\": \\\"미정의 변수 에러 해결\\\", \\\"impact\\\": \\\"컴파일 에러가 발생하여 빌드가 실패함\\\", \\\"cause_description\\\": \\\"undeclaredVar 변수가 선언되지 않아 컴파일 에러가 발생했습니다.\\\", \\\"pr_needed\\\": true, \\\"patch_summary\\\": \\\"미정의 변수를 문자열 리터럴로 치환했습니다.\\\", \\\"pr_title\\\": \\\"fix: declare undeclared variable in App.java\\\", \\\"pr_body\\\": \\\"This PR fixes compilation errors.\\\", \\\"patch_instructions\\\": [{\\\"file_path\\\": \\\"src/main/java/App.java\\\", \\\"old_code\\\": \\\"System.out.println(undeclaredVar);\\\", \\\"new_code\\\": \\\"System.out.println(\\\\\\\"Hello PikiLand\\\\\\\");\\\"}]}\"\n" +
                "    }\n" +
                "  }]\n" +
                "}";

        when(restTemplate.postForEntity(anyString(), any(HttpEntity.class), eq(String.class)))
                .thenReturn(new ResponseEntity<>(resStep1, HttpStatus.OK))
                .thenReturn(new ResponseEntity<>(resStep2, HttpStatus.OK))
                .thenReturn(new ResponseEntity<>(resStep3, HttpStatus.OK));

        when(githubAuthPort.createPullRequest(anyString(), anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn("https://github.com/test-owner/test-repo/pull/1");

        // 4. Run Self Healing process (Normally async, so we wait afterwards)
        selfHealingAppService.runSelfHealing(
                "test-owner/test-repo",
                "Build Failed. Symbol undeclaredVar not found.",
                "workflow_run",
                "9999",
                12345L
        );

        // 5. Wait for the Virtual Thread async task to complete
        boolean patched = false;
        for (int i = 0; i < 20; i++) {
            Thread.sleep(200);
            String content = Files.readString(badFile);
            if (content.contains("Hello PikiLand")) {
                patched = true;
                break;
            }
        }

        // 6. Verify local workspace changes
        String updatedCode = Files.readString(badFile);
        System.out.println("--- Updated Code inside Workspace ---");
        System.out.println(updatedCode);
        System.out.println("--------------------------------------");

        assertTrue(patched, "Code must be patched successfully within timeout.");
        assertFalse(updatedCode.contains("undeclaredVar"), "Deprecated variable must be removed.");

        // 7. Verify Mock expectations
        verify(githubAuthPort, times(1)).createPullRequest(
                eq("test-owner/test-repo"),
                eq("fix: declare undeclared variable in App.java"),
                eq("This PR fixes compilation errors."),
                anyString(), // unique branch
                eq("main"),
                eq("mock-token")
        );

        verify(notifierPort, times(1)).sendNotification(
                eq("https://hooks.slack.com/services/mock-webhook-url"),
                anyString(),
                any(AiAnalysisResult.class),
                eq("workflow_run"),
                eq("test-owner/test-repo"),
                eq("9999"),
                eq("https://github.com/test-owner/test-repo/pull/1")
        );

        System.out.println("Dry-run validation PASSED completely!");
    }
}
