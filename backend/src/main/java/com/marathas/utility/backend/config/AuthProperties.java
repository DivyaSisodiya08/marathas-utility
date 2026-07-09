package com.marathas.utility.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "auth")
public class AuthProperties {

    private String authMode;
    private String externalUrl;
    private String externalSubmitValue;

    public String getAuthMode() {
        return authMode;
    }

    public void setAuthMode(String authMode) {
        this.authMode = authMode;
    }

    public String getExternalUrl() {
        return externalUrl;
    }

    public void setExternalUrl(String externalUrl) {
        this.externalUrl = externalUrl;
    }

    public String getExternalSubmitValue() {
        return externalSubmitValue;
    }

    public void setExternalSubmitValue(String externalSubmitValue) {
        this.externalSubmitValue = externalSubmitValue;
    }
}