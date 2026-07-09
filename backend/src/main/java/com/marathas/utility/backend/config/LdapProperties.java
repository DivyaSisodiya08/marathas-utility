package com.marathas.utility.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ldap")
public class LdapProperties {

    private String authMode;
    private String dummyId;
    private String dummyPassword;
    private String url;
    private String baseDn;
    private String userSearchBase;
    private String userSearchFilter;
    private String externalUrl;
    private String externalSubmitValue;

    public String getAuthMode() {
        return authMode;
    }

    public void setAuthMode(String authMode) {
        this.authMode = authMode;
    }

    public String getDummyId() {
        return dummyId;
    }

    public void setDummyId(String dummyId) {
        this.dummyId = dummyId;
    }

    public String getDummyPassword() {
        return dummyPassword;
    }

    public void setDummyPassword(String dummyPassword) {
        this.dummyPassword = dummyPassword;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public String getBaseDn() {
        return baseDn;
    }

    public void setBaseDn(String baseDn) {
        this.baseDn = baseDn;
    }

    public String getUserSearchBase() {
        return userSearchBase;
    }

    public void setUserSearchBase(String userSearchBase) {
        this.userSearchBase = userSearchBase;
    }

    public String getUserSearchFilter() {
        return userSearchFilter;
    }

    public void setUserSearchFilter(String userSearchFilter) {
        this.userSearchFilter = userSearchFilter;
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
