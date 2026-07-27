package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.DashboardAppService;
import com.yourssu.pikiland.application.dto.RepoSettingsDto;
import com.yourssu.pikiland.presentation.security.AdminSecurityChecker;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.annotation.RegisteredOAuth2AuthorizedClient;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

import java.util.List;

@Controller
public class DashboardController {

    private final DashboardAppService dashboardAppService;
    private final AdminSecurityChecker adminSecurityChecker;

    public DashboardController(DashboardAppService dashboardAppService, AdminSecurityChecker adminSecurityChecker) {
        this.dashboardAppService = dashboardAppService;
        this.adminSecurityChecker = adminSecurityChecker;
    }

    @GetMapping("/")
    public String index() {
        return "index";
    }

    @GetMapping("/dashboard")
    public String viewDashboard(
            Model model,
            @AuthenticationPrincipal OAuth2User oauth2User,
            @RegisteredOAuth2AuthorizedClient("github") OAuth2AuthorizedClient authorizedClient) {

        String accessToken = authorizedClient.getAccessToken().getTokenValue();
        String username = oauth2User != null ? oauth2User.getAttribute("login") : "anonymous";
        boolean isAdmin = adminSecurityChecker.isAdmin(oauth2User);

        List<RepoSettingsDto> repos = dashboardAppService.getUserRepositories(accessToken);

        model.addAttribute("username", username);
        model.addAttribute("isAdmin", isAdmin);
        model.addAttribute("repos", repos);

        return "dashboard";
    }
}
