package com.marathas.utility.backend.controller;

import com.marathas.utility.backend.model.AuthResponse;
import com.marathas.utility.backend.model.LoginRequest;
import com.marathas.utility.backend.service.LdapAuthService;
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

    public static final String LDAP_USER_KEY = "ldap_user_id";
    public static final String GITHUB_ACCESS_KEY = "github_access";
    public static final String EXTERNAL_ACCESS_TOKEN_KEY = "external_access_token";

    private final LdapAuthService ldapAuthService;

    public AuthController(LdapAuthService ldapAuthService) {
        this.ldapAuthService = ldapAuthService;
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest request, HttpSession session) {
        String ldapId = request.getLoginId();
        LOGGER.info("/api/auth/login hit for user: {}", ldapId);
        String externalToken = ldapAuthService.authenticate(ldapId, request.getPassword());
        session.setAttribute(LDAP_USER_KEY, ldapId);
        session.setAttribute(GITHUB_ACCESS_KEY, true);
        if (externalToken != null && !externalToken.isBlank()) {
            session.setAttribute(EXTERNAL_ACCESS_TOKEN_KEY, externalToken);
            LOGGER.info("/api/auth/login received external token for user: {}", ldapId);
        }
     
        LOGGER.info("/api/auth/login success for user: {}", ldapId);

        return new AuthResponse(true, "Authentication successful", ldapId, true);
    }

    @PostMapping("/logout")
    public AuthResponse logout(HttpSession session) {
        session.invalidate();
        return new AuthResponse(true, "Logged out successfully", null, false);
    }
}
