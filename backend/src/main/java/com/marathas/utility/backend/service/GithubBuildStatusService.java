package com.marathas.utility.backend.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.databind.JsonNode;
import com.marathas.utility.backend.config.GithubOAuthProperties;

@Service
public class GithubBuildStatusService {

    private final RestClient restClient;
    private final GithubOAuthProperties properties;

    public GithubBuildStatusService(RestClient.Builder restClientBuilder, GithubOAuthProperties properties) {
        this.restClient = restClientBuilder.build();
        this.properties = properties;
    }

    public List<Map<String, String>> fetchActionRuns(String repoFullName, String branch, String workflowType) {
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];
        String sanitizedBranch = blankToNull(branch);
        String sanitizedWorkflowType = blankToNull(workflowType);
        if (sanitizedWorkflowType != null) {
            sanitizedWorkflowType = sanitizedWorkflowType.toLowerCase(Locale.ROOT);
            if (!"docker".equals(sanitizedWorkflowType)
                    && !"coverity".equals(sanitizedWorkflowType)
                    && !"blackduck".equals(sanitizedWorkflowType)
                    && !"twistlock".equals(sanitizedWorkflowType)) {
                throw new ResponseStatusException(
                        BAD_REQUEST,
                        "workflowType must be one of: docker, coverity, blackduck, twistlock");
            }
        }

        int perPage = 100;
        int maxRuns = 20;
        int maxPages = 10;

        try {
            List<Map<String, String>> runs = new ArrayList<>();
            int page = 1;

            while (page <= maxPages) {
                JsonNode response;
                if (sanitizedBranch == null) {
                    response = restClient.get()
                            .uri("https://api.github.com/repos/{owner}/{repo}/actions/runs?per_page={perPage}&page={page}",
                                    owner, repo, perPage, page)
                            .header("Authorization", "Bearer " + getToken())
                            .header("Accept", "application/vnd.github+json")
                            .retrieve()
                            .body(JsonNode.class);
                } else {
                    response = restClient.get()
                            .uri("https://api.github.com/repos/{owner}/{repo}/actions/runs?per_page={perPage}&page={page}&branch={branch}",
                                    owner, repo, perPage, page, sanitizedBranch)
                            .header("Authorization", "Bearer " + getToken())
                            .header("Accept", "application/vnd.github+json")
                            .retrieve()
                            .body(JsonNode.class);
                }

                if (response == null || !response.path("workflow_runs").isArray()) {
                    break;
                }

                JsonNode workflowRuns = response.path("workflow_runs");
                if (workflowRuns.isEmpty()) {
                    break;
                }

                for (JsonNode run : workflowRuns) {
                    String runName = run.path("name").asText("");
                    String runDisplayTitle = run.path("display_title").asText("");
                    String runEvent = run.path("event").asText("");
                    if (!matchesWorkflowType(runName, runDisplayTitle, runEvent, sanitizedWorkflowType)) {
                        continue;
                    }

                    Map<String, String> item = new LinkedHashMap<>();
                    item.put("id", run.path("id").asText(""));
                    item.put("runNumber", run.path("run_number").asText(""));
                    item.put("name", runName);
                    item.put("displayTitle", runDisplayTitle);
                    item.put("event", runEvent);
                    item.put("status", run.path("status").asText(""));
                    item.put("conclusion", run.path("conclusion").asText(""));
                    item.put("headBranch", run.path("head_branch").asText(""));
                    item.put("createdAt", run.path("created_at").asText(""));
                    item.put("updatedAt", run.path("updated_at").asText(""));
                    item.put("htmlUrl", run.path("html_url").asText(""));
                    runs.add(item);

                    if (runs.size() >= maxRuns) {
                        return runs;
                    }
                }

                if (workflowRuns.size() < perPage) {
                    break;
                }
                page++;
            }

            return runs;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to fetch workflow runs: " + e.getMessage());
        }
    }

    public Map<String, String> triggerActionRun(String repoFullName, String branch, String workflowType) {
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];
        String sanitizedBranch = requireValue(branch, "branch");
        String sanitizedWorkflowType = requireValue(workflowType, "workflowType").toLowerCase(Locale.ROOT);

        if (!"docker".equals(sanitizedWorkflowType)
                && !"coverity".equals(sanitizedWorkflowType)
                && !"blackduck".equals(sanitizedWorkflowType)
                && !"twistlock".equals(sanitizedWorkflowType)) {
            throw new ResponseStatusException(BAD_REQUEST, "workflowType must be one of: docker, coverity, bdh, twistlock");
        }

        try {
            JsonNode workflowsResponse = restClient.get()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/workflows?per_page=100", owner, repo)
                    .header("Authorization", "Bearer " + getToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .body(JsonNode.class);

            if (workflowsResponse == null || !workflowsResponse.path("workflows").isArray()) {
                throw new ResponseStatusException(NOT_FOUND, "No workflows found in repository");
            }

            String workflowId = null;
            String workflowName = null;
            String workflowTypeKey = sanitizedWorkflowType == null ? "" : sanitizedWorkflowType;
            for (JsonNode workflow : workflowsResponse.path("workflows")) {
                String name = workflow.path("name").asText("");
                String path = workflow.path("path").asText("");
                String text = (name + " " + path).toLowerCase(Locale.ROOT);

                boolean isMatch = switch (workflowTypeKey) {
                    case "docker" -> text.contains("docker") || text.contains("image-build") || text.contains("image build");
                    case "coverity" -> text.contains("coverity");
                    case "twistlock" -> text.contains("twistlock");
                    case "blackduck" -> text.contains("blackduck");
                    default -> false;
                };

                if (isMatch) {
                    workflowId = workflow.path("id").asText("");
                    workflowName = name;
                    break;
                }
            }

            if (workflowId == null || workflowId.isBlank()) {
                throw new ResponseStatusException(
                        NOT_FOUND,
                        "No matching workflow found for type " + sanitizedWorkflowType
                                + ". Ensure workflow name or file path contains that keyword.");
            }

                String requestBody = "{\"ref\":\"" + sanitizedBranch.replace("\"", "\\\"") + "\"}";
            restClient.post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflowId}/dispatches",
                            owner, repo, workflowId)
                    .header("Authorization", "Bearer " + getToken())
                    .header("Accept", "application/vnd.github+json")
                    .header("Content-Type", "application/json")
                    .body(requestBody)
                    .retrieve()
                    .toBodilessEntity();

            Map<String, String> result = new LinkedHashMap<>();
            result.put("repoFullName", repoFullName);
            result.put("branch", sanitizedBranch);
            result.put("workflowType", sanitizedWorkflowType);
            result.put("workflowName", workflowName == null ? "" : workflowName);
            result.put("status", "queued");
            return result;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to trigger workflow run: " + e.getMessage());
        }
    }

    private boolean matchesWorkflowType(
            String runName,
            String runDisplayTitle,
            String runEvent,
            String workflowType) {
        if (workflowType == null) {
            return true;
        }

        String workflowText = (runName + " " + runDisplayTitle + " " + runEvent).toLowerCase(Locale.ROOT);

        if ("docker".equals(workflowType)) {
            return workflowText.contains("docker") || workflowText.contains("image build");
        }
        if ("coverity".equals(workflowType)) {
            return workflowText.contains("coverity");
        }
        if ("blackduck".equals(workflowType)) {
            return workflowText.contains("blackduck");
        }
        if ("twistlock".equals(workflowType)) {
            return workflowText.contains("twistlock");
        }

        return true;
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

    private String requireValue(String value, String fieldName) {
        String normalized = blankToNull(value);
        if (normalized == null) {
            throw new ResponseStatusException(BAD_REQUEST, fieldName + " is required");
        }
        return normalized;
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
