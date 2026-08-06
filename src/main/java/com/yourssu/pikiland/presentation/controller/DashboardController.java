package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.DashboardAppService;
import com.yourssu.pikiland.application.dto.RepoSettingsDto;
import com.yourssu.pikiland.presentation.security.AdminSecurityChecker;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
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
    private final OAuth2AuthorizedClientService authorizedClientService;

    @Autowired
    public DashboardController(DashboardAppService dashboardAppService, 
                               AdminSecurityChecker adminSecurityChecker,
                               OAuth2AuthorizedClientService authorizedClientService) {
        this.dashboardAppService = dashboardAppService;
        this.adminSecurityChecker = adminSecurityChecker;
        this.authorizedClientService = authorizedClientService;
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

        String accessToken = (authorizedClient != null && authorizedClient.getAccessToken() != null) 
                ? authorizedClient.getAccessToken().getTokenValue() : null;
        String username = oauth2User != null ? oauth2User.getAttribute("login") : "anonymous";
        boolean isAdmin = adminSecurityChecker.isAdmin(oauth2User);

        List<RepoSettingsDto> repos = (accessToken != null) ? dashboardAppService.getUserRepositories(accessToken) : List.of();

        model.addAttribute("username", username);
        model.addAttribute("isAdmin", isAdmin);
        model.addAttribute("repos", repos);

        return "dashboard";
    }

    @GetMapping({"/setup", "/install/callback", "/github/callback"})
    public String viewSetupSuccess(
            Model model,
            @AuthenticationPrincipal OAuth2User oauth2User) {

        String accessToken = null;
        if (oauth2User != null) {
            try {
                OAuth2AuthorizedClient client = authorizedClientService.loadAuthorizedClient("github", oauth2User.getName());
                if (client != null && client.getAccessToken() != null) {
                    accessToken = client.getAccessToken().getTokenValue();
                }
            } catch (Exception ignored) {
                // Fallback gracefully for unauthenticated or partial OAuth states
            }
        }

        String username = oauth2User != null ? oauth2User.getAttribute("login") : "anonymous";
        List<RepoSettingsDto> repos = (accessToken != null) ? dashboardAppService.getUserRepositories(accessToken) : List.of();

        model.addAttribute("username", username);
        model.addAttribute("repos", repos);

        return "setup";
    }
}
