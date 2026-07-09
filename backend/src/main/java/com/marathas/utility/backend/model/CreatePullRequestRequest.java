package com.marathas.utility.backend.model;

import com.fasterxml.jackson.annotation.JsonAlias;

public class CreatePullRequestRequest {

    private String repoFullName;
    private String baseBranch;

    @JsonAlias("branchName")
    private String compareBranch;

    private String title;
    private String body;

    public String getRepoFullName() {
        return repoFullName;
    }

    public void setRepoFullName(String repoFullName) {
        this.repoFullName = repoFullName;
    }

    public String getBaseBranch() {
        return baseBranch;
    }

    public void setBaseBranch(String baseBranch) {
        this.baseBranch = baseBranch;
    }

    public String getCompareBranch() {
        return compareBranch;
    }

    public void setCompareBranch(String compareBranch) {
        this.compareBranch = compareBranch;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getBody() {
        return body;
    }

    public void setBody(String body) {
        this.body = body;
    }
}
