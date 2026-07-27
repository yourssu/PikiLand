package com.yourssu.pikiland.presentation.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class AdminSecurityChecker {

    @Value("${app.admin.users:}")
    private String adminUsersConfig;

    @Value("${app.ai.dry-run:false}")
    private boolean dryRun;

    public boolean isAdmin(OAuth2User oauth2User) {
        if (dryRun) {
            return true;
        }
        if (oauth2User == null) {
            return false;
        }
        String login = oauth2User.getAttribute("login");
        if (login == null || login.isBlank()) {
            return false;
        }
        List<String> adminList = Arrays.stream(adminUsersConfig.split(","))
                .map(String::trim)
                .filter(s -> !s.isBlank())
                .collect(Collectors.toList());
        return adminList.contains(login);
    }
}
