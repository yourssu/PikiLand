package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.application.service.DashboardAppService;
import com.yourssu.pikiland.application.dto.RepoSettingsDto;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings")
public class SettingsApiController {

    private final DashboardAppService dashboardAppService;

    public SettingsApiController(DashboardAppService dashboardAppService) {
        this.dashboardAppService = dashboardAppService;
    }

    @PostMapping
    public ResponseEntity<Void> updateSettings(@RequestBody RepoSettingsDto dto) {
        dashboardAppService.updateRepoSettings(dto);
        return ResponseEntity.ok().build();
    }
}
