package com.marathas.utility.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "github.oauth")
public class GithubOAuthProperties {

    private String personalToken;

    public String getPersonalToken() {
        return personalToken;
    }

    public void setPersonalToken(String personalToken) {
        this.personalToken = personalToken;
    }
}
