package com.marathas.utility.backend.model;

public class AuthResponse {

    private boolean success;
    private String message;
    private String ldapId;
    private boolean hasGithubAccess;

    public AuthResponse(boolean success, String message, String ldapId, boolean hasGithubAccess) {
        this.success = success;
        this.message = message;
        this.ldapId = ldapId;
        this.hasGithubAccess = hasGithubAccess;
    }

    public boolean isSuccess() {
        return success;
    }

    public String getMessage() {
        return message;
    }

    public String getLdapId() {
        return ldapId;
    }

    public boolean isHasGithubAccess() {
        return hasGithubAccess;
    }
}
