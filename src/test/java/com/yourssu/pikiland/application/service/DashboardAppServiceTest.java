package com.yourssu.pikiland.application.service;

import com.yourssu.pikiland.application.dto.RepoSettingsDto;
import com.yourssu.pikiland.domain.model.RepoSettings;
import com.yourssu.pikiland.domain.port.GithubAuthPort;
import com.yourssu.pikiland.domain.port.RepoSettingsRepository;
import com.yourssu.pikiland.domain.port.SystemSettingsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Arrays;
import java.util.Collections;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

class DashboardAppServiceTest {

    private RepoSettingsRepository repoSettingsRepository;
    private SystemSettingsRepository systemSettingsRepository;
    private HarnessInferenceService harnessInferenceService;
    private GithubAuthPort githubAuthPort;
    private DashboardAppService dashboardAppService;

    @BeforeEach
    void setUp() {
        repoSettingsRepository = Mockito.mock(RepoSettingsRepository.class);
        systemSettingsRepository = Mockito.mock(SystemSettingsRepository.class);
        harnessInferenceService = new HarnessInferenceService(repoSettingsRepository);
        githubAuthPort = Mockito.mock(GithubAuthPort.class);

        dashboardAppService = Mockito.spy(new DashboardAppService(
                repoSettingsRepository, systemSettingsRepository, harnessInferenceService, githubAuthPort
        ));
    }

    @Test
    @DisplayName("reInferHarness - Node.js 레포지토리(package.json)인 경우 npm test가 추론되며 gradlew로 하드코딩되지 않는다")
    void reInferHarness_NodeJsRepo_InfersNpmTest() {
        String repo = "owner/node-app";
        Mockito.doReturn(Arrays.asList("package.json", "index.js"))
                .when(dashboardAppService).fetchRemoteRepoFilenames(repo, "token");
        when(repoSettingsRepository.findById(repo))
                .thenReturn(Optional.of(new RepoSettings(repo, false, "", "", "")));
        when(githubAuthPort.isAppInstalledForRepo(repo)).thenReturn(true);

        RepoSettingsDto dto = dashboardAppService.reInferHarness(repo, "token");

        assertNotNull(dto);
        assertEquals("npm test", dto.getInferredHarnessCmd(), "Should infer 'npm test' for Node.js project");
        assertTrue(dto.isHasAppInstalled());
    }

    @Test
    @DisplayName("reInferHarness - 파일 목록 조회가 실패한 경우 gradlew test를 하드코딩해서 덮어쓰지 않는다")
    void reInferHarness_EmptyFiles_DoesNotHardcodeGradlew() {
        String repo = "owner/unknown-app";
        Mockito.doReturn(Collections.emptyList())
                .when(dashboardAppService).fetchRemoteRepoFilenames(repo, "token");
        when(repoSettingsRepository.findById(repo))
                .thenReturn(Optional.of(new RepoSettings(repo, false, "", "", "")));
        when(githubAuthPort.isAppInstalledForRepo(repo)).thenReturn(false);

        RepoSettingsDto dto = dashboardAppService.reInferHarness(repo, "token");

        assertNotNull(dto);
        assertNotEquals("./gradlew test", dto.getInferredHarnessCmd(), "Should not hardcode ./gradlew test on empty file list");
        assertFalse(dto.isHasAppInstalled());
    }
}
