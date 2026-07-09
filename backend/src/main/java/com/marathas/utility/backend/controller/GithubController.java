package com.marathas.utility.backend.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;
import com.marathas.utility.backend.service.GithubOAuthService;

import jakarta.servlet.http.HttpSession;

@RestController
@RequestMapping("/api/github")
public class GithubController {

    private static final String REPOS_CACHE_KEY = "github_repos_cache";

    private final GithubOAuthService githubOAuthService;

    public GithubController(GithubOAuthService githubOAuthService) {
        this.githubOAuthService = githubOAuthService;
    }

    @GetMapping("/repos")
    public List<JsonNode> getAllRepos(
            @RequestParam(defaultValue = "false") boolean refresh,
            HttpSession session) {
        Object cachedRepos = session.getAttribute(REPOS_CACHE_KEY);
        if (!refresh && cachedRepos instanceof List<?> cachedList && !cachedList.isEmpty()) {
            @SuppressWarnings("unchecked")
            List<JsonNode> repos = (List<JsonNode>) cachedList;
            return repos;
        }

        List<JsonNode> repos = githubOAuthService.fetchAllRepos();
        session.setAttribute(REPOS_CACHE_KEY, repos);
        return repos;
    }

    @GetMapping("/pom")
    public Map<String, String> getPomInfo(
            @RequestParam String repoFullName,
            @RequestParam(defaultValue = "master") String branch) {
        return githubOAuthService.fetchPomInfo(repoFullName, branch);
    }

    @GetMapping("/branches")
    public List<String> getBranches(@RequestParam String repoFullName) {
        return githubOAuthService.fetchRepoBranches(repoFullName);
    }

    @GetMapping("/actions/runs")
    public List<Map<String, String>> getActionRuns(
            @RequestParam String repoFullName,
            @RequestParam(required = false) String branch) {
        return githubOAuthService.fetchActionRuns(repoFullName, branch);
    }

    @PostMapping("/actions/dispatch")
    public Map<String, String> triggerActionRun(
            @RequestParam String repoFullName,
            @RequestParam String branch,
            @RequestParam String workflowType) {
        return githubOAuthService.triggerActionRun(repoFullName, branch, workflowType);
    }

    @PostMapping("/branch")
    public Map<String, String> createBranch(
            @RequestParam String repoFullName,
            @RequestParam String branchName) {
        return githubOAuthService.createBranch(repoFullName, branchName);
    }

    @PostMapping("/pr")
    public Map<String, String> createPullRequest(
            @RequestParam String repoFullName,
            @RequestParam String branchName,
            @RequestParam String title,
            @RequestParam String body) {
        return githubOAuthService.createPullRequest(repoFullName, branchName, title, body);
    }

    @PostMapping("/upgrade-pr")
    public Map<String, String> createUpgradePullRequest(@RequestBody Map<String, String> request) {
        return githubOAuthService.createUpgradePullRequest(request);
    }

    @PostMapping("/release-cut")
    public Map<String, String> createReleaseCut(@RequestBody Map<String, String> request) {
        return githubOAuthService.createReleaseCut(request);
    }

    @PostMapping("/release-cut/preview")
    public Map<String, Object> previewReleaseCut(@RequestBody Map<String, String> request) {
        return githubOAuthService.previewReleaseCut(request);
    }
}
