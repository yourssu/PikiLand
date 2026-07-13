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
import org.springframework.test.context.ActiveProfiles;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("local")
public class DryRunTest {

    static {
        try {
            Path envPath = Paths.get(".env");
            if (Files.exists(envPath)) {
                List<String> lines = Files.readAllLines(envPath);
                for (String line : lines) {
                    line = line.trim();
                    if (line.isEmpty() || line.startsWith("#")) continue;
                    int eqIdx = line.indexOf('=');
                    if (eqIdx != -1) {
                        String key = line.substring(0, eqIdx).trim();
                        String val = line.substring(eqIdx + 1).trim();
                        if (val.startsWith("\"") && val.endsWith("\"")) {
                            val = val.substring(1, val.length() - 1);
                        } else if (val.startsWith("'") && val.endsWith("'")) {
                            val = val.substring(1, val.length() - 1);
                        }
                        System.setProperty(key, val);
                        System.out.println("[DryRunTest Env] Loaded: " + key + " = " + val);
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("Failed to load .env file in DryRunTest static block: " + e.getMessage());
        }
    }

    @Autowired
    private SelfHealingAppService selfHealingAppService;

    @Autowired
    private RepoSettingsRepository settingsRepository;

    @SpyBean
    private WorkspacePort workspacePort;

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

        // 2. Persist mock settings in database using real model name from .env
        String modelName = System.getProperty("AI_MODEL", "gpt-4o");
        System.out.println("[DryRunTest] Using AI Model: " + modelName);
        settingsRepository.save(new RepoSettings(
                "test-owner/test-repo",
                true,
                "https://hooks.slack.com/services/mock-webhook-url",
                modelName
        ));

        // 3. Setup Mocks and Spy (We DO NOT mock RestTemplate so the real OpenAI HTTP calls go through)
        doReturn(mockWorkspace).when(workspacePort).cloneRepository(anyString(), anyString());
        doNothing().when(workspacePort).commitAndPush(any(Path.class), anyString(), anyString(), anyString(), anyString());
        doAnswer(invocation -> {
            Files.writeString(badFile, badCode);
            return null;
        }).when(workspacePort).resetToCleanState(any(Path.class), anyString());
        doReturn("main").when(workspacePort).getCurrentBranch(any(Path.class));
        // Prevent the finally-block cleanup from deleting mockWorkspace before assertions read the patched file
        doNothing().when(workspacePort).deleteWorkspace(any(Path.class));
        
        when(githubAuthPort.getInstallationAccessToken(anyLong())).thenReturn("mock-token");
        when(githubAuthPort.downloadWorkflowLogs(anyString(), anyString(), anyString())).thenReturn("Build Failed. Symbol undeclaredVar not found.");

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
        for (int i = 0; i < 180; i++) { // Increase wait steps for real AI gateway response latency
            Thread.sleep(500);
            String content = Files.readString(badFile);
            if (!content.equals(badCode)) {
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
        assertNotEquals(badCode, updatedCode, "Code must be modified from original buggy code.");

        // 7. Verify Mock expectations
        verify(githubAuthPort, atLeastOnce()).createPullRequest(
                eq("test-owner/test-repo"),
                anyString(), // Real AI might generate different PR title
                anyString(), // Real AI might generate different PR body
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
                anyList()
        );

        System.out.println("Dry-run validation PASSED completely!");
    }
}
