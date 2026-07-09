package com.marathas.utility.backend.model;

public class AuthResponse {

    private final boolean success;
    private final String message;
    private final String loginId;
    private final boolean hasGithubAccess;

    public AuthResponse(boolean success, String message, String loginId, boolean hasGithubAccess) {
        this.success = success;
        this.message = message;
        this.loginId = loginId;
        this.hasGithubAccess = hasGithubAccess;
    }

    public boolean isSuccess() {
        return success;
    }

    public String getMessage() {
        return message;
    }

    public String getLoginId() {
        return loginId;
    }

    public boolean isHasGithubAccess() {
        return hasGithubAccess;
    }
}
