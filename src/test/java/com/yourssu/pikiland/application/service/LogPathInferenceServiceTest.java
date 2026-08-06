package com.yourssu.pikiland.application.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class LogPathInferenceServiceTest {

    private LogPathInferenceService logPathInferenceService;

    @BeforeEach
    void setUp() {
        logPathInferenceService = new LogPathInferenceService();
    }

    @Test
    @DisplayName("Gradle 또는 Spring 설정 파일 포맷이 있는 경우 Spring 로그 경로를 추론한다.")
    void inferLogPath_spring() {
        String path1 = logPathInferenceService.inferLogPath(List.of("build.gradle.kts"), null);
        assertThat(path1).contains("/var/log/spring/");

        String path2 = logPathInferenceService.inferLogPath(null, "logging.file.name=application.log");
        assertThat(path2).isEqualTo("/var/log/spring/application.log");
    }

    @Test
    @DisplayName("package.json이 있는 경우 Node.js 로그 경로를 추론한다.")
    void inferLogPath_node() {
        String path = logPathInferenceService.inferLogPath(List.of("package.json"), null);
        assertThat(path).contains("/var/log/node/");
    }

    @Test
    @DisplayName("requirements.txt가 있는 경우 Python 로그 경로를 추론한다.")
    void inferLogPath_python() {
        String path = logPathInferenceService.inferLogPath(List.of("requirements.txt"), null);
        assertThat(path).contains("/var/log/python/");
    }
}
