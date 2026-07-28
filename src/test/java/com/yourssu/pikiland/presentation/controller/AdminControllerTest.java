package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.presentation.security.AdminSecurityChecker;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.view;

@WebMvcTest(controllers = AdminController.class)
@Import(SecurityConfig.class)
class AdminControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AdminSecurityChecker adminSecurityChecker;

    @MockBean
    private ClientRegistrationRepository clientRegistrationRepository;

    @Test
    @DisplayName("관리자 권한이 있는 사용자가 /admin에 접근하면 200 OK 및 admin 뷰를 반환한다")
    void viewAdminPage_AsAdmin_ReturnsAdminView() throws Exception {
        given(adminSecurityChecker.isAdmin(any())).willReturn(true);

        mockMvc.perform(get("/admin")
                .with(oauth2Login().attributes(attrs -> attrs.put("login", "admin_user"))))
                .andExpect(status().isOk())
                .andExpect(view().name("admin"));
    }

    @Test
    @DisplayName("관리자 권한이 없는 일반 사용자가 /admin에 접근하면 403 Forbidden을 반환한다")
    void viewAdminPage_AsNonAdmin_ReturnsForbidden() throws Exception {
        given(adminSecurityChecker.isAdmin(any())).willReturn(false);

        mockMvc.perform(get("/admin")
                .with(oauth2Login().attributes(attrs -> attrs.put("login", "normal_user"))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("인증되지 않은 사용자가 /admin에 접근하면 로그인 페이지로 리다이렉트된다")
    void viewAdminPage_Unauthenticated_RedirectsToLogin() throws Exception {
        mockMvc.perform(get("/admin"))
                .andExpect(status().is3xxRedirection());
    }
}
