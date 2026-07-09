package com.marathas.utility.backend.model;

import com.fasterxml.jackson.annotation.JsonAlias;

public class LoginRequest {

    @JsonAlias("username")
    private String ldapId;
    private String password;

    public String getLdapId() {
        return ldapId;
    }

    public void setLdapId(String ldapId) {
        this.ldapId = ldapId;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getLoginId() {
        return ldapId;
    }
}
