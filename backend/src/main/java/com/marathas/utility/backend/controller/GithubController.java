package com.marathas.utility.backend.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;
import com.marathas.utility.backend.model.CreatePullRequestRequest;
import com.marathas.utility.backend.service.GithubBuildStatusService;
import com.marathas.utility.backend.service.GithubOAuthService;
import com.marathas.utility.backend.service.GithubPullRequestService;
import com.marathas.utility.backend.service.SnapshotUpgradeService;

import jakarta.servlet.http.HttpSession;

@RestController
@RequestMapping("/api/github")
public class GithubController {

    private static final String REPOS_CACHE_KEY = "github_repos_cache";

    private final GithubOAuthService githubOAuthService;
    private final GithubBuildStatusService githubBuildStatusService;
    private final GithubPullRequestService githubPullRequestService;
    private final SnapshotUpgradeService snapshotUpgradeService;

    public GithubController(
            GithubOAuthService githubOAuthService,
            GithubBuildStatusService githubBuildStatusService,
            GithubPullRequestService githubPullRequestService,
            SnapshotUpgradeService snapshotUpgradeService) {
        this.githubOAuthService = githubOAuthService;
        this.githubBuildStatusService = githubBuildStatusService;
        this.githubPullRequestService = githubPullRequestService;
        this.snapshotUpgradeService = snapshotUpgradeService;
    }

    @GetMapping("/repos")
    public List<JsonNode> getAllRepos(
            @RequestParam(defaultValue = "false") boolean refresh,
            @RequestHeader(value = "X-GitHub-PAT", required = false) String patToken,
            HttpSession session) {
        Object cachedRepos = session.getAttribute(REPOS_CACHE_KEY);
        if (!refresh && cachedRepos instanceof List<?> cachedList && !cachedList.isEmpty()) {
            @SuppressWarnings("unchecked")
            List<JsonNode> repos = (List<JsonNode>) cachedList;
            return repos;
        }

        if (!refresh) {
            List<JsonNode> persistedRepos = githubOAuthService.readPersistedReposCache();
            if (!persistedRepos.isEmpty()) {
                session.setAttribute(REPOS_CACHE_KEY, persistedRepos);
                return persistedRepos;
            }
        }

        List<JsonNode> repos = githubOAuthService.fetchAllRepos(patToken);
        session.setAttribute(REPOS_CACHE_KEY, repos);
        githubOAuthService.persistReposCache(repos);
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
            @RequestParam(required = false) String branch,
            @RequestParam(required = false) String workflowType) {
        return githubBuildStatusService.fetchActionRuns(repoFullName, branch, workflowType);
    }

    @PostMapping("/actions/dispatch")
    public Map<String, String> triggerActionRun(
            @RequestParam String repoFullName,
            @RequestParam String branch,
            @RequestParam String workflowType) {
        return githubBuildStatusService.triggerActionRun(repoFullName, branch, workflowType);
    }

    @PostMapping("/branch")
    public Map<String, String> createBranch(
            @RequestParam String repoFullName,
            @RequestParam String branchName) {
        return githubOAuthService.createBranch(repoFullName, branchName);
    }

    @PostMapping("/pr")
    public Map<String, String> createPullRequest(@RequestBody CreatePullRequestRequest request) {
        return githubPullRequestService.createPullRequest(
                request.getRepoFullName(),
                request.getBaseBranch(),
                request.getCompareBranch(),
                request.getTitle(),
                request.getBody());
    }

    @PostMapping("/pr/create")
    public Map<String, String> createPullRequestWithCreatePath(@RequestBody CreatePullRequestRequest request) {
        return createPullRequest(request);
    }

    @PostMapping("/upgrade-pr")
    public Map<String, String> createUpgradePullRequest(@RequestBody Map<String, String> request) {
        return githubOAuthService.createUpgradePullRequest(request);
    }

    @PostMapping("/upgrade-pr/preview")
    public Map<String, Object> previewUpgradePullRequest(@RequestBody Map<String, String> request) {
        return githubOAuthService.previewUpgradePullRequest(request);
    }

    @PostMapping("/release-cut")
    public Map<String, String> createReleaseCut(@RequestBody Map<String, String> request) {
        return githubOAuthService.createReleaseCut(request);
    }

    @PostMapping("/release-cut/preview")
    public Map<String, Object> previewReleaseCut(@RequestBody Map<String, String> request) {
        return githubOAuthService.previewReleaseCut(request);
    }

    @PostMapping("/snapshot-upgrade/preview")
    public Map<String, Object> previewSnapshotUpgrade(@RequestBody Map<String, String> request) {
        return snapshotUpgradeService.previewSnapshotUpgrade(request);
    }

    @PostMapping("/snapshot-upgrade")
    public Map<String, String> applySnapshotUpgrade(@RequestBody Map<String, String> request) {
        return snapshotUpgradeService.applySnapshotUpgrade(request);
    }
}
