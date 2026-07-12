package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.DashboardAppService;
import com.yourssu.pikiland.application.dto.RepoSettingsDto;
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

    public DashboardController(DashboardAppService dashboardAppService) {
        this.dashboardAppService = dashboardAppService;
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
        String username = oauth2User.getAttribute("login");
        
        List<RepoSettingsDto> repos = dashboardAppService.getUserRepositories(accessToken);
        
        model.addAttribute("username", username);
        model.addAttribute("repos", repos);
        
        return "dashboard";
    }
}
