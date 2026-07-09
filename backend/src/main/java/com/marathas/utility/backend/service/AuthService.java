package com.marathas.utility.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.marathas.utility.backend.config.AuthProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

import java.util.Objects;

import static org.springframework.http.HttpStatus.UNAUTHORIZED;

@Service
public class AuthService {

    private static final Logger LOGGER = LoggerFactory.getLogger(AuthService.class);

    private final AuthProperties authProperties;
    private final RestClient restClient;

    public AuthService(AuthProperties authProperties, RestClient.Builder restClientBuilder) {
        this.authProperties = authProperties;
        this.restClient = restClientBuilder.build();
    }

    public String authenticate(String loginId, String password) {
        LOGGER.info("/api/auth/login hit for user: {}", loginId);

        if (isBlank(loginId) || isBlank(password)) {
            throw new ResponseStatusException(UNAUTHORIZED, "User ID and password are required");
        }

        if (isExternalMode()) {
            return authenticateWithExternalApi(loginId, password);
        }

        authenticateDummy(loginId, password);
        return null;
    }

    private String authenticateWithExternalApi(String loginId, String password) {
        String configuredExternalUrl = authProperties.getExternalUrl();
        if (isBlank(configuredExternalUrl)) {
            throw new ResponseStatusException(UNAUTHORIZED, "External authentication URL is not configured");
        }

        String externalUrl = Objects.requireNonNull(configuredExternalUrl);
        MediaType multipartFormData = Objects.requireNonNull(MediaType.MULTIPART_FORM_DATA);

        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("username", loginId);
        form.add("password", password);
        form.add("submit", isBlank(authProperties.getExternalSubmitValue()) ? "Login" : authProperties.getExternalSubmitValue());

        try {
            JsonNode response = restClient.post()
                    .uri(externalUrl)
                    .contentType(multipartFormData)
                    .accept(MediaType.APPLICATION_JSON)
                    .body(form)
                    .retrieve()
                    .body(JsonNode.class);

            String token = extractToken(response);
            if (isBlank(token)) {
                throw new ResponseStatusException(UNAUTHORIZED, "External authentication succeeded but token is missing");
            }

            return token;
        } catch (RestClientResponseException e) {
            throw new ResponseStatusException(UNAUTHORIZED, "External authentication failed: HTTP " + e.getStatusCode().value());
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(UNAUTHORIZED, "External authentication failed: " + e.getMessage());
        }
    }

    private String extractToken(JsonNode response) {
        if (response == null || response.isNull()) {
            return null;
        }

        String[] tokenPaths = {
                "token",
                "access_token",
                "accessToken",
                "jwt",
                "id_token",
                "data.token",
                "data.access_token",
                "data.accessToken"
        };

        for (String tokenPath : tokenPaths) {
            JsonNode tokenNode = response.at("/" + tokenPath.replace(".", "/"));
            if (!tokenNode.isMissingNode() && !tokenNode.isNull()) {
                String value = tokenNode.asText();
                if (!isBlank(value)) {
                    return value;
                }
            }
        }

        return null;
    }

    private void authenticateDummy(String loginId, String password) {
        if (isBlank(loginId) || isBlank(password)) {
            throw new ResponseStatusException(UNAUTHORIZED, "User ID and password are required");
        }
    }

    private boolean isExternalMode() {
        String mode = authProperties.getAuthMode();
        return mode != null && mode.equalsIgnoreCase("external");
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}