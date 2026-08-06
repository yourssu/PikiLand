package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.LogIngestService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(LogReceiverController.class)
@org.springframework.context.annotation.Import(SecurityConfig.class)
class LogReceiverControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private LogIngestService logIngestService;

    @MockBean
    private org.springframework.security.oauth2.client.registration.ClientRegistrationRepository clientRegistrationRepository;

    @Test
    @DisplayName("유효하지 않은 Bearer Token 수신 시 401 Unauthorized 반환한다.")
    void ingestLogs_unauthorized() throws Exception {
        mockMvc.perform(post("/api/logs/ingest")
                .header("Authorization", "Bearer invalid_token")
                .contentType(MediaType.APPLICATION_JSON)
                .content("[{\"log\":\"test\"}]"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("유효한 Bearer Token 및 JSON 수신 시 200 OK 및 수신 레코드 수를 반환한다.")
    void ingestLogs_success() throws Exception {
        when(logIngestService.processIngestedLogs(eq("yourssu/PikiLand"), any())).thenReturn(1);

        mockMvc.perform(post("/api/logs/ingest")
                .header("Authorization", "Bearer your_secure_agent_token_here")
                .header("X-Pikiland-Repo", "yourssu/PikiLand")
                .contentType(MediaType.APPLICATION_JSON)
                .content("[{\"log\":\"java.lang.NullPointerException at UserService.java:42\"}]"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.processed_records").value(1));
    }
}
