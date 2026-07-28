package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.WebhookAppService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.BDDMockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.anyString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = {WebhookController.class, DashboardController.class})
@Import(SecurityConfig.class)
class SecurityConfigTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private WebhookAppService webhookAppService;

    @MockBean
    private com.yourssu.pikiland.application.service.DashboardAppService dashboardAppService;

    @MockBean
    private com.yourssu.pikiland.presentation.security.AdminSecurityChecker adminSecurityChecker;

    @MockBean
    private org.springframework.security.oauth2.client.registration.ClientRegistrationRepository clientRegistrationRepository;

    @Test
    @DisplayName("SecurityConfig - Webhook 엔드포인트는 CSRF 토큰 없이 POST 요청해도 403이 발생하지 않고 수용된다")
    void webhookEndpoint_IgnoresCsrf() throws Exception {
        BDDMockito.given(webhookAppService.handleEvent(anyString(), anyString(), anyString())).willReturn(true);

        mockMvc.perform(post("/webhook")
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-GitHub-Event", "workflow_run")
                .header("X-Hub-Signature-256", "sha256=test")
                .content("{}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("SecurityConfig - static 리소스와 메인 루트는 인증 없이 접근 허용된다")
    void publicEndpoints_PermitAll() throws Exception {
        mockMvc.perform(get("/"))
                .andExpect(status().isOk());
    }
}
