package com.marathas.utility.backend.controller;

import com.marathas.utility.backend.model.AuthResponse;
import com.marathas.utility.backend.model.LoginRequest;
import com.marathas.utility.backend.service.AuthService;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Logger LOGGER = LoggerFactory.getLogger(AuthController.class);

    public static final String AUTHENTICATED_USER_KEY = "authenticated_user_id";
    public static final String GITHUB_ACCESS_KEY = "github_access";
    public static final String EXTERNAL_ACCESS_TOKEN_KEY = "external_access_token";

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest request, HttpSession session) {
        String loginId = request.getLoginId();
        LOGGER.info("/api/auth/login hit for user: {}", loginId);
        String externalToken = authService.authenticate(loginId, request.getPassword());
        session.setAttribute(AUTHENTICATED_USER_KEY, loginId);
        session.setAttribute(GITHUB_ACCESS_KEY, true);
        if (externalToken != null && !externalToken.isBlank()) {
            session.setAttribute(EXTERNAL_ACCESS_TOKEN_KEY, externalToken);
            LOGGER.info("/api/auth/login received external token for user: {}", loginId);
        }
     
        LOGGER.info("/api/auth/login success for user: {}", loginId);

        return new AuthResponse(true, "Authentication successful", loginId, true);
    }

    @PostMapping("/logout")
    public AuthResponse logout(HttpSession session) {
        session.invalidate();
        return new AuthResponse(true, "Logged out successfully", null, false);
    }
}
