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
    public ResponseEntity<Void> updateSettings(
            @RequestBody RepoSettingsDto dto,
            @AuthenticationPrincipal OAuth2User oauth2User) {

        // --- Ownership Gate (production only) ---
        // Skipped when isDebug=true so local/debug environments remain frictionless.
        if (!isDebug && oauth2User != null) {
            String[] parts = dto.getFullName() == null ? new String[0] : dto.getFullName().split("/", 2);
            if (parts.length < 2 || parts[0].isBlank()) {
                return ResponseEntity.badRequest().build();
            }
            String repoOwner = parts[0];
            String authenticatedUser = oauth2User.getAttribute("login");

            if (!repoOwner.equals(authenticatedUser)) {
                System.err.println("[Settings] FORBIDDEN — user '" + authenticatedUser +
                        "' attempted to modify settings for repo '" + dto.getFullName() + "'");
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
        }

        dashboardAppService.updateRepoSettings(dto);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/harness/approve")
    public ResponseEntity<RepoSettingsDto> approveHarness(
            @RequestBody RepoSettingsDto dto,
            @AuthenticationPrincipal OAuth2User oauth2User) {
        if (!isDebug && oauth2User != null && !isOwner(dto.getFullName(), oauth2User)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        RepoSettingsDto result = dashboardAppService.approveInferredHarness(dto.getFullName());
        return ResponseEntity.ok(result);
    }

    @PostMapping("/harness/infer")
    public ResponseEntity<RepoSettingsDto> inferHarness(
            @RequestBody RepoSettingsDto dto,
            @AuthenticationPrincipal OAuth2User oauth2User) {
        if (!isDebug && oauth2User != null && !isOwner(dto.getFullName(), oauth2User)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        RepoSettingsDto result = dashboardAppService.reInferHarness(dto.getFullName());
        return ResponseEntity.ok(result);
    }

    private boolean isOwner(String fullName, OAuth2User oauth2User) {
        if (fullName == null || oauth2User == null) return false;
        String[] parts = fullName.split("/", 2);
        if (parts.length < 2 || parts[0].isBlank()) return false;
        String authenticatedUser = oauth2User.getAttribute("login");
        return parts[0].equals(authenticatedUser);
    }
}
