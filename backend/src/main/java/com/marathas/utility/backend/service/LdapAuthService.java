package com.marathas.utility.backend.service;

import java.util.Hashtable;

import javax.naming.Context;
import javax.naming.NamingException;
import javax.naming.directory.DirContext;
import javax.naming.directory.InitialDirContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.databind.JsonNode;
import com.marathas.utility.backend.config.LdapProperties;

@Service
public class LdapAuthService {

    private final LdapProperties ldapProperties;
    private final RestClient restClient;
    private static final Logger LOGGER = LoggerFactory.getLogger(LdapAuthService.class);
    public LdapAuthService(LdapProperties ldapProperties, RestClient.Builder restClientBuilder) {
        this.ldapProperties = ldapProperties;
        this.restClient = restClientBuilder.build();
    }

    public String authenticate(String ldapId, String password) {
    LOGGER.info("/api/auth/login hit for user: {}", ldapId);  
        if (isBlank(ldapId) || isBlank(password)) {
            throw new ResponseStatusException(UNAUTHORIZED, "User ID and password are required");
        }

        if (isExternalMode()) {
            return authenticateWithExternalApi(ldapId, password);
        }

        if (isDummyMode()) {
            authenticateDummy(ldapId, password);
            return null;
        }

        if (isBlank(ldapProperties.getUrl())) {
            throw new ResponseStatusException(UNAUTHORIZED, "LDAP is not configured");
        }

        try {
            String userDn = buildUserDn(ldapId);
            authenticateWithLdap(userDn, password);
            return null;
        } catch (NamingException e) {
            throw new ResponseStatusException(UNAUTHORIZED, "LDAP authentication failed: " + e.getMessage());
        }
    }

    private String authenticateWithExternalApi(String ldapId, String password) {
        String externalUrl = ldapProperties.getExternalUrl();
        if (isBlank(externalUrl)) {
            throw new ResponseStatusException(UNAUTHORIZED, "External authentication URL is not configured");
        }

        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("username", ldapId);
        form.add("password", password);
        form.add("submit", isBlank(ldapProperties.getExternalSubmitValue()) ? "Login" : ldapProperties.getExternalSubmitValue());

        try {
            JsonNode response = restClient.post()
                    .uri(externalUrl)
                    .contentType(MediaType.MULTIPART_FORM_DATA)
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

    private void authenticateDummy(String ldapId, String password) {
        // Temporary bypass: in dummy mode, accept any non-empty credentials.
        if (isBlank(ldapId) || isBlank(password)) {
            throw new ResponseStatusException(UNAUTHORIZED, "User ID and password are required");
        }
    }

    private boolean isDummyMode() {
        String mode = ldapProperties.getAuthMode();
        return mode == null || mode.isBlank() || mode.equalsIgnoreCase("dummy");
    }

    private boolean isExternalMode() {
        String mode = ldapProperties.getAuthMode();
        return mode != null && mode.equalsIgnoreCase("external");
    }

    private String buildUserDn(String ldapId) {
        String baseDn = ldapProperties.getBaseDn();
        if (isBlank(baseDn)) {
            throw new ResponseStatusException(UNAUTHORIZED, "LDAP base DN is not configured");
        }

        // user-search-filter is treated as RDN pattern (for example: uid={0} or cn={0}).
        String rdnPattern = ldapProperties.getUserSearchFilter();
        if (isBlank(rdnPattern) || !rdnPattern.contains("{0}")) {
            rdnPattern = "uid={0}";
        }

        String rdn = rdnPattern.replace("{0}", ldapId);
        String searchBase = ldapProperties.getUserSearchBase();

        if (isBlank(searchBase)) {
            return rdn + "," + baseDn;
        }

        return rdn + "," + searchBase + "," + baseDn;
    }

    private void authenticateWithLdap(String userDn, String password) throws NamingException {
        Hashtable<String, String> env = new Hashtable<>();
        env.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.ldap.LdapCtxFactory");
        env.put(Context.PROVIDER_URL, ldapProperties.getUrl());
        env.put(Context.SECURITY_PRINCIPAL, userDn);
        env.put(Context.SECURITY_CREDENTIALS, password);
        env.put(Context.SECURITY_AUTHENTICATION, "simple");
        env.put("com.sun.jndi.ldap.connect.timeout", "5000");
        env.put("com.sun.jndi.ldap.read.timeout", "5000");

        DirContext ctx = new InitialDirContext(env);
        ctx.close();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
