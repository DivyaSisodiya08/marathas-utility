package com.marathas.utility.backend.service;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.marathas.utility.backend.config.GithubOAuthProperties;

@Service
public class GithubPullRequestService {

    private static final Logger log = LoggerFactory.getLogger(GithubPullRequestService.class);

    private final RestClient restClient;
    private final GithubOAuthProperties properties;
    private final ObjectMapper objectMapper;

    public GithubPullRequestService(RestClient.Builder restClientBuilder, GithubOAuthProperties properties) {
        this.restClient = restClientBuilder.build();
        this.properties = properties;
        this.objectMapper = new ObjectMapper();
    }

    public Map<String, String> createPullRequest(String repoFullName, String compareBranch, String title, String body) {
        return createPullRequest(repoFullName, "master", compareBranch, title, body);
    }

    public Map<String, String> createPullRequest(
            String repoFullName,
            String baseBranch,
            String compareBranch,
            String title,
            String body) {
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];
        String sanitizedBaseBranch = normalizeBranch(baseBranch, "master");
        String sanitizedCompareBranch = requireValue(compareBranch, "compareBranch");
        String sanitizedTitle = requireValue(title, "title");
        String normalizedBody = body == null ? "" : body.trim();

        try {
            JsonNode prResponse = restClient.post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/pulls", owner, repo)
                    .header("Authorization", "Bearer " + getToken())
                    .header("Accept", "application/vnd.github+json")
                    .body(Map.of(
                            "title", sanitizedTitle,
                            "body", normalizedBody,
                            "head", sanitizedCompareBranch,
                            "base", sanitizedBaseBranch
                    ))
                    .retrieve()
                    .body(JsonNode.class);

            if (prResponse == null || prResponse.path("html_url").isMissingNode()) {
                throw new ResponseStatusException(NOT_FOUND, "PR creation response invalid");
            }

            Map<String, String> result = new LinkedHashMap<>();
            result.put("prUrl", prResponse.path("html_url").asText());
            result.put("prNumber", prResponse.path("number").asText());
            result.put("baseBranch", sanitizedBaseBranch);
            result.put("compareBranch", sanitizedCompareBranch);
            result.put("created", "true");
            log.info("PR created: {}/{} PR#{}", owner, repo, result.get("prNumber"));
            return result;

        } catch (HttpClientErrorException.UnprocessableEntity e) {
            String githubMessage = extractGithubErrorMessage(e.getResponseBodyAsString());
            Map<String, String> existingPr = findExistingPullRequest(owner, repo, sanitizedBaseBranch, sanitizedCompareBranch);

            if (existingPr != null && !existingPr.isEmpty()) {
                existingPr.put("baseBranch", sanitizedBaseBranch);
                existingPr.put("compareBranch", sanitizedCompareBranch);
                existingPr.put("created", "false");
                existingPr.put("existing", "true");
                log.info("Existing PR reused: {}/{} PR#{}", owner, repo, existingPr.get("prNumber"));
                return existingPr;
            }

            if (githubMessage.toLowerCase(Locale.ROOT).contains("no commits between")) {
                throw new ResponseStatusException(
                        BAD_REQUEST,
                        "Failed to create PR: No commits between compare branch " + sanitizedCompareBranch
                                + " and base branch " + sanitizedBaseBranch);
            }

            throw new ResponseStatusException(BAD_REQUEST, "Failed to create PR: " + githubMessage);

        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to create PR: " + e.getMessage());
        }
    }

    private String[] parseOwnerRepo(String repoFullName) {
        if (repoFullName == null || repoFullName.isBlank() || !repoFullName.contains("/")) {
            throw new ResponseStatusException(NOT_FOUND, "Invalid repoFullName. Expected owner/repo");
        }
        String[] parts = repoFullName.split("/", 2);
        if (parts[0].isBlank() || parts[1].isBlank()) {
            throw new ResponseStatusException(NOT_FOUND, "Invalid repoFullName. Expected owner/repo");
        }
        return parts;
    }

    private Map<String, String> findExistingPullRequest(String owner, String repo, String baseBranch, String compareBranch) {
        JsonNode response = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/pulls?state=open&base={base}&head={owner}:{head}",
                        owner, repo, baseBranch, owner, compareBranch)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);

        if (response == null || !response.isArray() || response.isEmpty()) {
            return null;
        }

        JsonNode first = response.get(0);
        Map<String, String> result = new LinkedHashMap<>();
        result.put("prUrl", first.path("html_url").asText(""));
        result.put("prNumber", first.path("number").asText(""));
        result.put("state", first.path("state").asText(""));
        return result;
    }

    private String extractGithubErrorMessage(String responseBody) {
        String value = blankToNull(responseBody);
        if (value == null) {
            return "GitHub validation failed";
        }

        try {
            JsonNode json = objectMapper.readTree(value);
            String message = blankToNull(json.path("message").asText(""));
            return message == null ? value : message;
        } catch (Exception e) {
            return value;
        }
    }

    private String requireValue(String value, String fieldName) {
        String normalized = blankToNull(value);
        if (normalized == null) {
            throw new ResponseStatusException(BAD_REQUEST, fieldName + " is required");
        }
        return normalized;
    }

    private String normalizeBranch(String branch, String fallback) {
        String normalized = blankToNull(branch);
        return normalized == null ? fallback : normalized;
    }

    private String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private String getToken() {
        String token = blankToNull(properties.getPersonalToken());
        if (token == null) {
            token = blankToNull(System.getenv("GITHUB_PERSONAL_TOKEN"));
        }
        if (token == null) {
            throw new ResponseStatusException(
                    UNAUTHORIZED,
                    "GitHub personal token not configured. Set github.oauth.personal-token or "
                    + "GITHUB_PERSONAL_TOKEN and restart backend.");
        }
        return token;
    }
}
