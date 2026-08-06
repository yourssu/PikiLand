package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.domain.model.LogFingerprint;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.infrastructure.persistence.InMemoryLogFingerprintRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class LogIngestServiceTest {

    private LlmLogClassifierService llmClassifierService;
    private InMemoryLogFingerprintRepository fingerprintRepository;
    private SelfHealingAppService selfHealingAppService;
    private com.yourssu.pikiland.domain.port.RepoSettingsRepository repoSettingsRepository;
    private LogIngestService logIngestService;

    @BeforeEach
    void setUp() {
        llmClassifierService = new LlmLogClassifierService();
        fingerprintRepository = new InMemoryLogFingerprintRepository();
        selfHealingAppService = Mockito.mock(SelfHealingAppService.class);
        repoSettingsRepository = Mockito.mock(com.yourssu.pikiland.domain.port.RepoSettingsRepository.class);

        RepoSettings repo = new RepoSettings("yourssu/PikiLand", true, null, null, null);
        Mockito.when(repoSettingsRepository.findAll()).thenReturn(List.of(repo));
        Mockito.when(repoSettingsRepository.findById("yourssu/PikiLand")).thenReturn(Optional.of(repo));

        logIngestService = new LogIngestService(llmClassifierService, fingerprintRepository, selfHealingAppService, repoSettingsRepository);
    }

    @Test
    @DisplayName("타임스탬프와 스레드 ID가 달라도 동일한 에러 스택트레이스는 정규화 핑거프린트로 동일하게 중복 제어된다.")
    void processIngestedLogs_deduplication() {
        String rawLog1 = "2026-08-05 21:59:45.123 [exec-1] ERROR java.lang.NullPointerException at UserService.java:42";
        String rawLog2 = "2026-08-05 21:59:46.999 [exec-7] ERROR java.lang.NullPointerException at UserService.java:42";

        List<Map<String, Object>> payloads1 = List.of(Map.of("log", rawLog1));
        List<Map<String, Object>> payloads2 = List.of(Map.of("log", rawLog2));

        // 1회차 수신: Self-Healing 파이프라인 트리거 실행
        int count1 = logIngestService.processIngestedLogs("yourssu/PikiLand", payloads1);
        assertThat(count1).isEqualTo(1);
        verify(selfHealingAppService, times(1)).runSelfHealing(eq("yourssu/PikiLand"), anyString(), eq("production_log"), anyString(), anyLong(), anyString(), anyString());

        // 2회차 수신 (1초 뒤 동일 에러): 핑거프린트 중복 제어로 Self-Healing 중복 트리거 생략
        int count2 = logIngestService.processIngestedLogs("yourssu/PikiLand", payloads2);
        assertThat(count2).isEqualTo(1);
        verify(selfHealingAppService, times(1)).runSelfHealing(eq("yourssu/PikiLand"), anyString(), eq("production_log"), anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    @DisplayName("단순 사용자 입력값('숫자 500 포함')은 LLM 검증으로 필터링되어 트리거되지 않는다.")
    void processIngestedLogs_benignInputFiltered() {
        String benignLog = "User typed input: 500 items selected";
        List<Map<String, Object>> payloads = List.of(Map.of("log", benignLog));

        int count = logIngestService.processIngestedLogs("yourssu/PikiLand", payloads);
        assertThat(count).isEqualTo(0);
        verify(selfHealingAppService, times(0)).runSelfHealing(any(), any(), any(), any(), anyLong(), any(), any());
    }
}
