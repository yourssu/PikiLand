package com.yourssu.pikiland.application.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.yourssu.pikiland.domain.port.LogFingerprintRepository;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import com.yourssu.pikiland.domain.port.SystemSettingsRepository;

class WebhookAppServiceTest {

    private SelfHealingAppService selfHealingAppService;
    private SystemSettingsRepository systemSettingsRepository;
    private RepoSettingsRepository repoSettingsRepository;
    private LogFingerprintRepository logFingerprintRepository;
    private WebhookAppService webhookAppService;

    @BeforeEach
    void setUp() {
        selfHealingAppService = Mockito.mock(SelfHealingAppService.class);
        systemSettingsRepository = Mockito.mock(SystemSettingsRepository.class);
        repoSettingsRepository = Mockito.mock(RepoSettingsRepository.class);
        logFingerprintRepository = Mockito.mock(LogFingerprintRepository.class);
        webhookAppService = new WebhookAppService(selfHealingAppService, systemSettingsRepository, repoSettingsRepository, logFingerprintRepository);
        ReflectionTestUtils.setField(webhookAppService, "isDebug", true);
    }

    @Test
    @DisplayName("PikiLand 자체 워크플로 실패 시 self-healing 트리거를 무시하여 무한 루프를 방지한다")
    void handleEvent_PikilandWorkflowFailure_Skipped() {
        String payload = """
                {
                  "action": "completed",
                  "installation": { "id": 12345 },
                  "repository": {
                    "full_name": "yourssu/pikiland",
                    "default_branch": "main"
                  },
                  "workflow_run": {
                    "id": 99999,
                    "name": "PikiLand Self-Healing",
                    "path": ".github/workflows/pikiland.yml",
                    "conclusion": "failure",
                    "head_branch": "main"
                  }
                }
                """;

        webhookAppService.handleEvent("workflow_run", payload, null);

        verify(selfHealingAppService, never()).runSelfHealing(
                anyString(), anyString(), anyString(), anyString(), anyLong(), anyString(), anyString()
        );
    }

    @Test
    @DisplayName("일반 CI 워크플로 실패 시 정상적으로 self-healing을 트리거한다")
    void handleEvent_OtherWorkflowFailure_Triggered() {
        String payload = """
                {
                  "action": "completed",
                  "installation": { "id": 12345 },
                  "repository": {
                    "full_name": "yourssu/pikiland",
                    "default_branch": "main"
                  },
                  "workflow_run": {
                    "id": 88888,
                    "name": "Gradle Build & Test",
                    "path": ".github/workflows/ci.yml",
                    "conclusion": "failure",
                    "head_branch": "feature/bugfix"
                  }
                }
                """;

        webhookAppService.handleEvent("workflow_run", payload, null);

        verify(selfHealingAppService).runSelfHealing(
                eq("yourssu/pikiland"),
                eq(null),
                eq("workflow_run"),
                eq("88888"),
                eq(12345L),
                eq("feature/bugfix"),
                eq("main")
        );
    }
}
