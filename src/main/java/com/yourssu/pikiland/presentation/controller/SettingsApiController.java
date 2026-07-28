package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.DashboardAppService;
import com.yourssu.pikiland.application.dto.RepoSettingsDto;
import com.yourssu.pikiland.application.dto.SystemSettingsDto;
import com.yourssu.pikiland.presentation.security.AdminSecurityChecker;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings")
public class SettingsApiController {

    private final DashboardAppService dashboardAppService;
    private final AdminSecurityChecker adminSecurityChecker;

    /**
     * Ownership check is skipped when isDebug is true (local/debug environment).
     * In production, only the repository owner may modify its PikiLand settings.
     */
    @Value("${app.debug:false}")
    private boolean isDebug;

    public SettingsApiController(DashboardAppService dashboardAppService, AdminSecurityChecker adminSecurityChecker) {
        this.dashboardAppService = dashboardAppService;
        this.adminSecurityChecker = adminSecurityChecker;
    }

    @GetMapping("/system")
    public ResponseEntity<SystemSettingsDto> getSystemSettings(@AuthenticationPrincipal OAuth2User oauth2User) {
        if (!adminSecurityChecker.isAdmin(oauth2User)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        return ResponseEntity.ok(dashboardAppService.getSystemSettings());
    }

    @PostMapping("/system")
    public ResponseEntity<Void> updateSystemSettings(
            @RequestBody SystemSettingsDto dto,
            @AuthenticationPrincipal OAuth2User oauth2User) {
        if (!adminSecurityChecker.isAdmin(oauth2User)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        dashboardAppService.updateSystemSettings(dto);
        return ResponseEntity.ok().build();
    }

    @PostMapping
    public ResponseEntity<RepoSettingsDto> updateSettings(
            @RequestBody RepoSettingsDto dto,
            @AuthenticationPrincipal OAuth2User oauth2User) {

        if (!isDebug) {
            if (oauth2User == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
            if (!isAuthorizedUser(dto.getFullName(), oauth2User)) {
                System.err.println("[Settings] FORBIDDEN — user '" + oauth2User.getAttribute("login") +
                        "' attempted to modify settings for repo '" + dto.getFullName() + "'");
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
        }

        dashboardAppService.updateRepoSettings(dto);
        RepoSettingsDto updated = dashboardAppService.reInferHarness(dto.getFullName());
        return ResponseEntity.ok(updated);
    }

    @PostMapping("/harness/approve")
    public ResponseEntity<RepoSettingsDto> approveHarness(
            @RequestBody RepoSettingsDto dto,
            @AuthenticationPrincipal OAuth2User oauth2User) {
        if (!isDebug) {
            if (oauth2User == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
            if (!isAuthorizedUser(dto.getFullName(), oauth2User)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
        }
        RepoSettingsDto result = dashboardAppService.approveInferredHarness(dto.getFullName());
        return ResponseEntity.ok(result);
    }

    @PostMapping("/harness/infer")
    public ResponseEntity<RepoSettingsDto> inferHarness(
            @RequestBody RepoSettingsDto dto,
            @AuthenticationPrincipal OAuth2User oauth2User,
            @org.springframework.security.oauth2.client.annotation.RegisteredOAuth2AuthorizedClient("github") org.springframework.security.oauth2.client.OAuth2AuthorizedClient authorizedClient) {
        if (!isDebug) {
            if (oauth2User == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }
            if (!isAuthorizedUser(dto.getFullName(), oauth2User)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
        }
        String token = (authorizedClient != null && authorizedClient.getAccessToken() != null) ?
                authorizedClient.getAccessToken().getTokenValue() : null;
        RepoSettingsDto result = dashboardAppService.reInferHarness(dto.getFullName(), token);
        return ResponseEntity.ok(result);
    }

    private boolean isAuthorizedUser(String fullName, OAuth2User oauth2User) {
        if (fullName == null || oauth2User == null) return false;
        String[] parts = fullName.split("/", 2);
        if (parts.length < 2 || parts[0].isBlank()) return false;
        String authenticatedUser = oauth2User.getAttribute("login");
        if (authenticatedUser != null && parts[0].equalsIgnoreCase(authenticatedUser)) {
            return true;
        }
        // Allow System Admins to manage any repository
        if (adminSecurityChecker.isAdmin(oauth2User)) {
            return true;
        }
        // Reject unauthorized users if neither owner nor system admin
        return false;
    }
}
