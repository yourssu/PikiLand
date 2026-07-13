package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.DashboardAppService;
import com.yourssu.pikiland.application.dto.RepoSettingsDto;
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

    /**
     * Ownership check is skipped when dry-run is true (local/debug/integration-test environment).
     * In production, only the repository owner may modify its PikiLand settings.
     */
    @Value("${app.ai.dry-run:false}")
    private boolean dryRun;

    public SettingsApiController(DashboardAppService dashboardAppService) {
        this.dashboardAppService = dashboardAppService;
    }

    @PostMapping
    public ResponseEntity<Void> updateSettings(
            @RequestBody RepoSettingsDto dto,
            @AuthenticationPrincipal OAuth2User oauth2User) {

        // --- Ownership Gate (production only) ---
        // Skipped when dry-run=true so local/debug environments remain frictionless.
        if (!dryRun && oauth2User != null) {
            String[] parts = dto.getFullName() == null ? new String[0] : dto.getFullName().split("/", 2);
            if (parts.length < 2 || parts[0].isBlank()) {
                return ResponseEntity.badRequest().build();
            }
            String repoOwner = parts[0];
            String authenticatedUser = oauth2User.getAttribute("login");

            // Personal repos: owner segment must match the logged-in GitHub username.
            // Note: organisation repos require a separate GitHub API membership check
            // (tracked as a separate issue) — this covers the most common personal-repo case.
            if (!repoOwner.equals(authenticatedUser)) {
                System.err.println("[Settings] FORBIDDEN — user '" + authenticatedUser +
                        "' attempted to modify settings for repo '" + dto.getFullName() + "'");
                return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
            }
        }

        dashboardAppService.updateRepoSettings(dto);
        return ResponseEntity.ok().build();
    }
}
