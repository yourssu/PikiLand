package com.yourssu.pikiland.presentation.controller;

import com.yourssu.pikiland.presentation.security.AdminSecurityChecker;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.server.ResponseStatusException;

@Controller
public class AdminController {

    private final AdminSecurityChecker adminSecurityChecker;

    public AdminController(AdminSecurityChecker adminSecurityChecker) {
        this.adminSecurityChecker = adminSecurityChecker;
    }

    @GetMapping("/admin")
    public String viewAdminPage(Model model, @AuthenticationPrincipal OAuth2User oauth2User) {
        if (!adminSecurityChecker.isAdmin(oauth2User)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Access Denied: Admin privileges required.");
        }

        String username = oauth2User != null ? oauth2User.getAttribute("login") : "anonymous";
        model.addAttribute("username", username);
        model.addAttribute("isAdmin", true);

        return "admin";
    }
}
