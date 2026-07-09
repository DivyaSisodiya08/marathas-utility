package com.marathas.utility.backend.service;

import java.io.ByteArrayInputStream;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.marathas.utility.backend.config.GithubOAuthProperties;

@Service
public class GithubOAuthService {

    private static final Logger log = LoggerFactory.getLogger(GithubOAuthService.class);

    private record PomFile(String path, String sha, String content, String branch) {

    }

    private record GitRef(String branch, String sha) {

    }

    private record RepoTextFile(String path, String sha, String content, String branch) {

    }

    private final RestClient restClient;
    private final GithubOAuthProperties properties;
    private final ObjectMapper objectMapper;

    public GithubOAuthService(RestClient.Builder restClientBuilder, GithubOAuthProperties properties) {
        this.restClient = restClientBuilder.build();
        this.properties = properties;
        this.objectMapper = new ObjectMapper();
    }

    public List<JsonNode> fetchAllRepos() {
        String token = getToken();
        List<JsonNode> allRepos = new ArrayList<>();
        int perPage = 50;
        int page = 1;
        while (true) {
            JsonNode result = null;
            int attempts = 0;

            while (attempts < 3) {
                try {
                    String rawResponse = restClient.get()
                            .uri("https://api.github.com/user/repos?per_page={perPage}&page={page}", perPage, page)
                            .header("Authorization", "Bearer " + token)
                            .header("Accept", "application/vnd.github+json")
                            .retrieve()
                            .body(String.class);

                    if (rawResponse == null || rawResponse.isBlank()) {
                        result = null;
                        break;
                    }

                    result = objectMapper.readTree(rawResponse);
                    break;
                } catch (Exception e) {
                    attempts++;
                    log.warn("GitHub repos page {} fetch failed on attempt {}: {}", page, attempts, e.getMessage());
                    if (attempts >= 3) {
                        throw new ResponseStatusException(
                                NOT_FOUND,
                                "Failed to fetch repositories from GitHub. Please retry.");
                    }
                }
            }

            if (result == null || !result.isArray() || result.isEmpty()) {
                break;
            }

            for (JsonNode repo : result) {
                allRepos.add(repo);
            }

            if (result.size() < perPage) {
                break;
            }
            page++;
        }
        return allRepos;
    }

    public List<String> fetchRepoBranches(String repoFullName) {
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];

        List<String> branches = new ArrayList<>();
        int page = 1;

        try {
            while (true) {
                JsonNode result = restClient.get()
                        .uri("https://api.github.com/repos/{owner}/{repo}/branches?per_page=100&page={page}", owner, repo, page)
                        .header("Authorization", "Bearer " + getToken())
                        .header("Accept", "application/vnd.github+json")
                        .retrieve()
                        .body(JsonNode.class);

                if (result == null || !result.isArray() || result.isEmpty()) {
                    break;
                }

                for (JsonNode branchNode : result) {
                    String name = branchNode.path("name").asText("").trim();
                    if (!name.isEmpty()) {
                        branches.add(name);
                    }
                }

                if (result.size() < 100) {
                    break;
                }

                page++;
            }

            if (branches.isEmpty()) {
                throw new ResponseStatusException(NOT_FOUND, "No branches found for " + repoFullName);
            }

            return branches;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to fetch branches: " + e.getMessage());
        }
    }

    public List<Map<String, String>> fetchActionRuns(String repoFullName, String branch) {
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];
        String sanitizedBranch = blankToNull(branch);
        int perPage = 20;
        int maxRuns = 20;

        try {
            List<Map<String, String>> runs = new ArrayList<>();
            int page = 1;

            while (true) {
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
                    Map<String, String> item = new LinkedHashMap<>();
                    item.put("id", run.path("id").asText(""));
                    item.put("runNumber", run.path("run_number").asText(""));
                    item.put("name", run.path("name").asText(""));
                    item.put("displayTitle", run.path("display_title").asText(""));
                    item.put("event", run.path("event").asText(""));
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
        String sanitizedWorkflowType = requireValue(workflowType, "workflowType").toLowerCase();

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
            for (JsonNode workflow : workflowsResponse.path("workflows")) {
                String name = workflow.path("name").asText("");
                String path = workflow.path("path").asText("");
                String text = (name + " " + path).toLowerCase();

                boolean isMatch;
                if ("docker".equals(sanitizedWorkflowType)) {
                    isMatch = text.contains("docker") || text.contains("image-build") || text.contains("image build");
                } else if ("coverity".equals(sanitizedWorkflowType)) {
                    isMatch = text.contains("coverity");
                } else if ("twistlock".equals(sanitizedWorkflowType)) {
                    isMatch = text.contains("twistlock");
                } else {
                    isMatch = text.contains("blackduck");
                }

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
                                + ". Ensure workflow name or file path contains that keyword."
                );
            }

            restClient.post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflowId}/dispatches",
                            owner, repo, workflowId)
                    .header("Authorization", "Bearer " + getToken())
                    .header("Accept", "application/vnd.github+json")
                    .body(Map.of("ref", sanitizedBranch))
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

    public Map<String, String> fetchPomInfo(String repoFullName, String branch) {
        String requestedBranch = (branch == null || branch.isBlank()) ? "master" : branch;
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        PomFile pomFile = fetchPomFileWithFallback(ownerRepo[0], ownerRepo[1], requestedBranch);
        String pomXml = pomFile.content();

        try {
            Document doc = DocumentBuilderFactory.newInstance()
                    .newDocumentBuilder()
                    .parse(new ByteArrayInputStream(pomXml.getBytes(StandardCharsets.UTF_8)));
            doc.getDocumentElement().normalize();

            Map<String, String> props = extractProperties(doc);

            // Spring Boot version via parent groupId
            String springBootVersion = "";
            NodeList parents = doc.getElementsByTagName("parent");
            if (parents.getLength() > 0) {
                Element parent = (Element) parents.item(0);
                NodeList groupIds = parent.getElementsByTagName("groupId");
                if (groupIds.getLength() > 0) {
                    String groupId = groupIds.item(0).getTextContent().trim();
                    if (groupId.contains("springframework.boot")) {
                        NodeList versions = parent.getElementsByTagName("version");
                        if (versions.getLength() > 0) {
                            springBootVersion = resolve(versions.item(0).getTextContent().trim(), props);
                        }
                    }
                }
            }

            // Project version — first <version> directly under root element
            String projectVersion = "";
            NodeList rootChildren = doc.getDocumentElement().getChildNodes();
            for (int i = 0; i < rootChildren.getLength(); i++) {
                Node node = rootChildren.item(i);
                if (node.getNodeType() == Node.ELEMENT_NODE && "version".equals(node.getNodeName())) {
                    projectVersion = resolve(node.getTextContent().trim(), props);
                    break;
                }
            }

            String javaVersion = resolve(
                    props.getOrDefault("java.version", props.getOrDefault("maven.compiler.source", "")), props);

            Map<String, String> result = new LinkedHashMap<>();
            result.put("springBootVersion", springBootVersion);
            result.put("projectVersion", projectVersion);
            result.put("snapshotVersion", projectVersion);
            result.put("javaVersion", javaVersion);
            return result;

        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to parse pom.xml: " + e.getMessage());
        }
    }

    private String fetchPomWithFallback(String owner, String repo, String requestedBranch) {
        return fetchPomFileWithFallback(owner, repo, requestedBranch).content();
    }

    private RepoTextFile fetchDockerWorkflowExact(String owner, String repo, String branch) {
        return fetchTextFileFromContents(owner, repo, ".github/workflows/Docker.yml", branch);
    }

    private RepoTextFile fetchTextFileFromContents(String owner, String repo, String path, String branch) {
        JsonNode fileNode = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/contents/" + path + "?ref={branch}", owner, repo, branch)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);

        if (fileNode == null || fileNode.path("content").isMissingNode()) {
            throw new ResponseStatusException(NOT_FOUND, "File not found: " + path);
        }

        String encoded = fileNode.path("content").asText().replace("\n", "");
        byte[] decoded = Base64.getDecoder().decode(encoded);
        String content = new String(decoded, StandardCharsets.UTF_8);

        return new RepoTextFile(
                fileNode.path("path").asText(path),
                fileNode.path("sha").asText(),
                content,
                branch);
    }

    private String updateDockerWorkflowForReleaseCut(String workflowContent, String releaseBranch) {
        Pattern pattern = Pattern.compile("(?m)^(\\s*VERSION_TAG\\s*:\\s*\"?)([^\"\\r\\n]+)(\"?\\s*)$");
        Matcher matcher = pattern.matcher(workflowContent);
        StringBuffer sb = new StringBuffer();
        while (matcher.find()) {
            String currentValue = matcher.group(2);
            String updatedValue = currentValue.replace("-SNAPSHOT", "");
            String replacement = matcher.group(1) + Matcher.quoteReplacement(updatedValue) + matcher.group(3);
            matcher.appendReplacement(sb, replacement);
        }
        matcher.appendTail(sb);

        String updated = sb.toString();
        String targetBranch = requireValue(releaseBranch, "releaseBranch");
        // Keep workflow triggers aligned with release cut by targeting the release branch instead of master.
        return updated.replaceAll(
            "(?m)^(\\s*branches\\s*:\\s*\\[\\s*[\"']?)master([\"']?\\s*\\]\\s*)$",
            "$1" + Matcher.quoteReplacement(targetBranch) + "$2");
    }

    private String stripSnapshotSuffix(String version) {
        String normalized = requireValue(version, "version");
        if (normalized.toUpperCase(Locale.ROOT).endsWith("-SNAPSHOT")) {
            return normalized.substring(0, normalized.length() - "-SNAPSHOT".length());
        }
        return normalized;
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

    public Map<String, String> createBranch(String repoFullName, String branchName) {
        return createBranch(repoFullName, "master", branchName);
    }

    public Map<String, String> createBranch(String repoFullName, String sourceBranch, String branchName) {
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];
        String sanitizedSourceBranch = normalizeBranch(sourceBranch, "master");
        String sanitizedBranchName = requireValue(branchName, "branchName");

        try {
            GitRef sourceRef = fetchBranchRef(owner, repo, sanitizedSourceBranch);

            restClient.post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/git/refs", owner, repo)
                    .header("Authorization", "Bearer " + getToken())
                    .header("Accept", "application/vnd.github+json")
                    .body(Map.of(
                            "ref", "refs/heads/" + sanitizedBranchName,
                            "sha", sourceRef.sha()
                    ))
                    .retrieve()
                    .body(JsonNode.class);

            Map<String, String> result = new LinkedHashMap<>();
            result.put("branchName", sanitizedBranchName);
            result.put("sourceBranch", sourceRef.branch());
            result.put("created", "true");
            result.put("sha", sourceRef.sha());
            log.info("Branch created: {}/{} branch={} from {}", owner, repo, sanitizedBranchName, sourceRef.branch());
            return result;

        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to create branch: " + e.getMessage());
        }
    }

    public Map<String, String> createPullRequest(String repoFullName, String branchName, String title, String body) {
        return createPullRequest(repoFullName, "master", branchName, title, body);
    }

    public Map<String, String> createPullRequest(String repoFullName, String baseBranch, String branchName, String title, String body) {
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];
        String sanitizedBaseBranch = normalizeBranch(baseBranch, "master");

        try {
            JsonNode prResponse = restClient.post()
                    .uri("https://api.github.com/repos/{owner}/{repo}/pulls", owner, repo)
                    .header("Authorization", "Bearer " + getToken())
                    .header("Accept", "application/vnd.github+json")
                    .body(Map.of(
                            "title", title,
                            "body", body,
                            "head", branchName,
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
            result.put("created", "true");
            log.info("PR created: {}/{} PR#{}", owner, repo, result.get("prNumber"));
            return result;

        } catch (HttpClientErrorException.UnprocessableEntity e) {
            String githubMessage = extractGithubErrorMessage(e.getResponseBodyAsString());
            Map<String, String> existingPr = findExistingPullRequest(owner, repo, sanitizedBaseBranch, branchName);

            if (existingPr != null && !existingPr.isEmpty()) {
                existingPr.put("baseBranch", sanitizedBaseBranch);
                existingPr.put("created", "false");
                existingPr.put("existing", "true");
                log.info("Existing PR reused: {}/{} PR#{}", owner, repo, existingPr.get("prNumber"));
                return existingPr;
            }

            if (githubMessage.toLowerCase(Locale.ROOT).contains("no commits between")) {
                throw new ResponseStatusException(
                        BAD_REQUEST,
                        "Failed to create PR: No commits between compare branch " + branchName
                                + " and base branch " + sanitizedBaseBranch);
            }

            throw new ResponseStatusException(BAD_REQUEST, "Failed to create PR: " + githubMessage);

        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to create PR: " + e.getMessage());
        }
    }

    public Map<String, String> createUpgradePullRequest(Map<String, String> request) {
        String repoFullName = requireValue(request.get("repoFullName"), "repoFullName");
        String sourceBranch = normalizeBranch(request.get("sourceBranch"), "master");
        String baseBranch = normalizeBranch(request.get("baseBranch"), sourceBranch);
        String branchName = requireValue(request.get("branchName"), "branchName");
        String targetSpringBootVersion = blankToNull(request.get("targetSpringBootVersion"));
        String targetSnapshotVersion = blankToNull(request.get("targetSnapshotVersion"));
        String jiraTicket = blankToNull(request.get("jiraTicket"));

        if (targetSpringBootVersion == null && targetSnapshotVersion == null) {
            throw new ResponseStatusException(BAD_REQUEST, "At least one target version is required");
        }

        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];

        PomFile pomFile = fetchPomFileWithFallback(owner, repo, sourceBranch);
        Map<String, String> currentVersions = extractVersionInfo(pomFile.content());
        ensureBranchExists(repoFullName, pomFile.branch(), branchName);

        PomFile featurePomFile = fetchPomFromContents(owner, repo, pomFile.path(), branchName);
        if (featurePomFile == null) {
            featurePomFile = fetchPomFileWithFallback(owner, repo, branchName);
        }

        String updatedPom = updatePomVersions(featurePomFile.content(), targetSpringBootVersion, targetSnapshotVersion);
        if (updatedPom.equals(featurePomFile.content())) {
            throw new ResponseStatusException(
                BAD_REQUEST,
                "No version change detected in pom.xml for branch " + branchName + ". Update target versions first.");
        }

        String commitMessage = buildCommitMessage(targetSpringBootVersion, targetSnapshotVersion, jiraTicket);
        JsonNode commitResponse = updatePomFile(
            owner,
            repo,
            featurePomFile.path(),
            featurePomFile.sha(),
            branchName,
            updatedPom,
            commitMessage);

        String prTitle = buildPrTitle(repo, targetSpringBootVersion, targetSnapshotVersion, jiraTicket);
        String prBody = buildPrBody(
            currentVersions,
            targetSpringBootVersion,
            targetSnapshotVersion,
            jiraTicket,
            featurePomFile.path(),
            sourceBranch);
        Map<String, String> prResult = createPullRequest(repoFullName, baseBranch, branchName, prTitle, prBody);

        Map<String, String> result = new LinkedHashMap<>();
        result.put("branchName", branchName);
        result.put("baseBranch", baseBranch);
        result.put("sourceBranch", pomFile.branch());
        result.put("pomPath", featurePomFile.path());
        result.put("commitSha", commitResponse.path("commit").path("sha").asText(""));
        result.put("prUrl", prResult.getOrDefault("prUrl", ""));
        result.put("prNumber", prResult.getOrDefault("prNumber", ""));
        result.put("prCreated", prResult.getOrDefault("created", ""));
        result.put("prExisting", prResult.getOrDefault("existing", ""));
        return result;
    }

    public Map<String, String> createReleaseCut(Map<String, String> request) {
        String repoFullName = requireValue(request.get("repoFullName"), "repoFullName");
        String sourceBranch = normalizeBranch(request.get("sourceBranch"), "master");
        String jiraTicket = blankToNull(request.get("jiraTicket"));

        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];

        PomFile sourcePomFile = fetchPomFileWithFallback(owner, repo, sourceBranch);
        Map<String, String> versionInfo = extractVersionInfo(sourcePomFile.content());
        String currentVersion = requireValue(versionInfo.get("snapshotVersion"), "projectVersion");
        String releaseVersion = stripSnapshotSuffix(currentVersion);
        String releaseBranch = "release/" + releaseVersion;
        String requestedLastReleaseBranch = blankToNull(request.get("lastReleaseBranch"));
        String lastReleaseBranch = requestedLastReleaseBranch == null
            ? resolveLastReleaseBranch(repoFullName, releaseBranch)
            : requestedLastReleaseBranch;
        if (!isStrictReleaseVersionBranch(lastReleaseBranch)) {
            throw new ResponseStatusException(
                    BAD_REQUEST,
                    "lastReleaseBranch must be in format release/<version> (example: release/1.10.0)");
        }

        ensureBranchExists(repoFullName, lastReleaseBranch, releaseBranch);

        String releaseCutBranch = "feature/CIN-53810-release-cut";
        String requestedReleaseCutBranch = releaseCutBranch;
        boolean prRetryUsed = false;
        createBranch(repoFullName, "master", releaseCutBranch);

        PomFile featurePomFile = fetchPomFromContents(owner, repo, sourcePomFile.path(), releaseCutBranch);
        if (featurePomFile == null) {
            featurePomFile = fetchPomFileWithFallback(owner, repo, releaseCutBranch);
        }

        String pomAfterReleaseCut = updatePomVersions(
                removeSnapshotSuffixesFromPom(featurePomFile.content()),
                null,
                releaseVersion);

        JsonNode pomCommit = updateTextFile(
                owner,
                repo,
                featurePomFile.path(),
                featurePomFile.sha(),
                releaseCutBranch,
                pomAfterReleaseCut,
                buildReleaseCutCommitMessage(jiraTicket, releaseVersion));
        int additionalPomFilesUpdated = updateAdditionalPomFilesForReleaseCut(
            owner,
            repo,
            releaseCutBranch,
            featurePomFile.path(),
            jiraTicket,
            releaseVersion);

        String dockerWorkflowPath = "";
        String dockerWorkflowCommitSha = "";
        String dockerWorkflowUpdateStatus = "not-applicable";
        String dockerWorkflowSkipReason = "";
        try {
            RepoTextFile dockerWorkflow = fetchDockerWorkflowExact(owner, repo, releaseCutBranch);
            String updatedWorkflow = updateDockerWorkflowForReleaseCut(dockerWorkflow.content(), releaseBranch);
            if (!updatedWorkflow.equals(dockerWorkflow.content())) {
                JsonNode workflowCommit = updateTextFile(
                        owner,
                        repo,
                        dockerWorkflow.path(),
                        dockerWorkflow.sha(),
                        releaseCutBranch,
                        updatedWorkflow,
                        buildWorkflowCutCommitMessage(jiraTicket, releaseVersion));
                dockerWorkflowPath = dockerWorkflow.path();
                dockerWorkflowCommitSha = workflowCommit.path("commit").path("sha").asText("");
                dockerWorkflowUpdateStatus = "updated";
            } else {
                dockerWorkflowPath = dockerWorkflow.path();
                dockerWorkflowUpdateStatus = "no-change";
                dockerWorkflowSkipReason = "No Docker workflow updates needed (VERSION_TAG and branch triggers already aligned).";
            }
        } catch (ResponseStatusException e) {
            if (isWorkflowScopeForbidden(e.getReason())) {
                dockerWorkflowUpdateStatus = "skipped";
                dockerWorkflowSkipReason = "Token is missing workflow scope. Grant workflow permission to update .github/workflows/Docker.yml.";
            } else {
                throw e;
            }
        } catch (HttpClientErrorException.Forbidden e) {
            if (isWorkflowScopeForbidden(e.getResponseBodyAsString())) {
                dockerWorkflowUpdateStatus = "skipped";
                dockerWorkflowSkipReason = "Token is missing workflow scope. Grant workflow permission to update .github/workflows/Docker.yml.";
            } else {
                throw e;
            }
        } catch (HttpClientErrorException e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to update Docker workflow: " + e.getMessage());
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to update Docker workflow: " + e.getMessage());
        }

        if ("skipped".equals(dockerWorkflowUpdateStatus)) {
            log.warn("Docker workflow update skipped for {}: {}", repoFullName, dockerWorkflowSkipReason);
        } else if (!"updated".equals(dockerWorkflowUpdateStatus)) {
            log.info("Docker workflow update status for {}: {}", repoFullName, dockerWorkflowUpdateStatus);
        }

        String prTitle = buildReleaseCutPrTitle(repo, jiraTicket, releaseVersion);
        String prBody = buildReleaseCutPrBody(featurePomFile.path(), currentVersion, releaseVersion, dockerWorkflowPath);
        Map<String, String> releaseCutPr;
        try {
            releaseCutPr = createPullRequest(repoFullName, releaseBranch, releaseCutBranch, prTitle, prBody);
        } catch (ResponseStatusException e) {
            if (!isNoCommitsBetweenError(e.getReason())) {
                throw e;
            }

            String retryBranch = releaseCutBranch + "-from-release-"
                    + LocalDateTime.now().format(DateTimeFormatter.ofPattern("HHmmss"));
                createBranch(repoFullName, "master", retryBranch);
                prRetryUsed = true;

            PomFile retryPomFile = fetchPomFromContents(owner, repo, featurePomFile.path(), retryBranch);
            if (retryPomFile == null) {
                retryPomFile = fetchPomFileWithFallback(owner, repo, retryBranch);
            }

            String retryPomAfterReleaseCut = updatePomVersions(
                    removeSnapshotSuffixesFromPom(retryPomFile.content()),
                    null,
                    releaseVersion);

            pomCommit = updateTextFile(
                    owner,
                    repo,
                    retryPomFile.path(),
                    retryPomFile.sha(),
                    retryBranch,
                    retryPomAfterReleaseCut,
                    buildReleaseCutCommitMessage(jiraTicket, releaseVersion));
                additionalPomFilesUpdated = updateAdditionalPomFilesForReleaseCut(
                    owner,
                    repo,
                    retryBranch,
                    retryPomFile.path(),
                    jiraTicket,
                    releaseVersion);

            featurePomFile = retryPomFile;
            releaseCutBranch = retryBranch;

            try {
                RepoTextFile retryDockerWorkflow = fetchDockerWorkflowExact(owner, repo, retryBranch);
                String retryUpdatedWorkflow = updateDockerWorkflowForReleaseCut(retryDockerWorkflow.content(), releaseBranch);
                if (!retryUpdatedWorkflow.equals(retryDockerWorkflow.content())) {
                    JsonNode retryWorkflowCommit = updateTextFile(
                            owner,
                            repo,
                            retryDockerWorkflow.path(),
                            retryDockerWorkflow.sha(),
                            retryBranch,
                            retryUpdatedWorkflow,
                            buildWorkflowCutCommitMessage(jiraTicket, releaseVersion));
                    dockerWorkflowPath = retryDockerWorkflow.path();
                    dockerWorkflowCommitSha = retryWorkflowCommit.path("commit").path("sha").asText("");
                    dockerWorkflowUpdateStatus = "updated";
                    dockerWorkflowSkipReason = "";
                }
            } catch (Exception retryDockerEx) {
                log.warn("Retry branch Docker workflow update skipped for {}: {}", repoFullName, retryDockerEx.getMessage());
            }

            prBody = buildReleaseCutPrBody(featurePomFile.path(), currentVersion, releaseVersion, dockerWorkflowPath);
            releaseCutPr = createPullRequest(repoFullName, releaseBranch, releaseCutBranch, prTitle, prBody);
        }

        Map<String, String> result = new LinkedHashMap<>();
        result.put("releaseBranch", releaseBranch);
        result.put("releaseVersion", releaseVersion);
        result.put("sourceBranch", sourcePomFile.branch());
        result.put("releaseBaseBranch", lastReleaseBranch);
        result.put("featureBaseBranch", "master");
        result.put("requestedReleaseCutBranch", requestedReleaseCutBranch);
        result.put("releaseCutBranch", releaseCutBranch);
        result.put("prRetryUsed", String.valueOf(prRetryUsed));
        result.put("prUrl", releaseCutPr.getOrDefault("prUrl", ""));
        result.put("prNumber", releaseCutPr.getOrDefault("prNumber", ""));
        result.put("prCreated", releaseCutPr.getOrDefault("created", ""));
        result.put("prExisting", releaseCutPr.getOrDefault("existing", ""));
        result.put("prState", releaseCutPr.getOrDefault("state", ""));
        result.put("pomPath", featurePomFile.path());
        result.put("pomCommitSha", pomCommit.path("commit").path("sha").asText(""));
        result.put("dockerWorkflowPath", dockerWorkflowPath);
        result.put("dockerWorkflowCommitSha", dockerWorkflowCommitSha);
        result.put("dockerWorkflowUpdateStatus", dockerWorkflowUpdateStatus);
        result.put("dockerWorkflowSkipReason", dockerWorkflowSkipReason);
        result.put("additionalPomFilesUpdated", String.valueOf(additionalPomFilesUpdated));

        return result;
    }

    public Map<String, Object> previewReleaseCut(Map<String, String> request) {
        String repoFullName = requireValue(request.get("repoFullName"), "repoFullName");
        String sourceBranch = normalizeBranch(request.get("sourceBranch"), "master");

        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];

        PomFile sourcePomFile = fetchPomFileWithFallback(owner, repo, sourceBranch);
        Map<String, String> versionInfo = extractVersionInfo(sourcePomFile.content());
        String currentVersion = requireValue(versionInfo.get("snapshotVersion"), "projectVersion");
        String releaseVersion = stripSnapshotSuffix(currentVersion);

        List<PomFile> sourcePomFiles = fetchAllPomFiles(owner, repo, sourcePomFile.branch());
        if (sourcePomFiles.isEmpty()) {
            sourcePomFiles.add(sourcePomFile);
        }
        List<Map<String, String>> pomSnapshotFindings = new ArrayList<>();
        for (PomFile pomFile : sourcePomFiles) {
            pomSnapshotFindings.addAll(findPomSnapshotFindings(pomFile.path(), pomFile.content()));
        }

        String dockerWorkflowPath = ".github/workflows/Docker.yml";
        List<Map<String, String>> dockerSnapshotFindings = new ArrayList<>();
        try {
            RepoTextFile dockerWorkflow = fetchDockerWorkflowExact(owner, repo, sourcePomFile.branch());
            dockerWorkflowPath = dockerWorkflow.path();
            dockerSnapshotFindings = findDockerVersionTagSnapshotFindings(dockerWorkflow.path(), dockerWorkflow.content());
        } catch (ResponseStatusException e) {
            // Keep preview available even if Docker workflow does not exist.
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sourceBranch", sourcePomFile.branch());
        result.put("releaseVersion", releaseVersion);
        result.put("releaseBranch", "release/" + releaseVersion);
        result.put("pomPath", sourcePomFile.path());
        result.put("pomFilesScanned", sourcePomFiles.size());
        result.put("dockerWorkflowPath", dockerWorkflowPath);
        result.put("pomSnapshotFindings", pomSnapshotFindings);
        result.put("dockerSnapshotFindings", dockerSnapshotFindings);
        result.put("totalSnapshotFindings", pomSnapshotFindings.size() + dockerSnapshotFindings.size());
        return result;
    }

    private Map<String, String> extractProperties(Document doc) {
        Map<String, String> props = new LinkedHashMap<>();
        NodeList propertiesNodes = doc.getElementsByTagName("properties");
        if (propertiesNodes.getLength() == 0) {
            return props;
        }
        NodeList children = propertiesNodes.item(0).getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (node.getNodeType() == Node.ELEMENT_NODE) {
                props.put(node.getNodeName(), node.getTextContent().trim());
            }
        }
        return props;
    }

    private Map<String, String> extractVersionInfo(String pomXml) {
        try {
            Document doc = DocumentBuilderFactory.newInstance()
                    .newDocumentBuilder()
                    .parse(new ByteArrayInputStream(pomXml.getBytes(StandardCharsets.UTF_8)));
            doc.getDocumentElement().normalize();

            Map<String, String> props = extractProperties(doc);
            Map<String, String> result = new LinkedHashMap<>();
            result.put("springBootVersion", resolve(findSpringBootParentVersion(doc), props));
            result.put("snapshotVersion", resolve(findProjectVersion(doc), props));
            return result;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to inspect pom.xml: " + e.getMessage());
        }
    }

    private PomFile fetchPomFileWithFallback(String owner, String repo, String requestedBranch) {
        List<String> candidateBranches = buildCandidateBranches(owner, repo, requestedBranch);
        log.info("requested branch for {}/{}: {}", owner, repo, requestedBranch);

        for (String candidateBranch : candidateBranches) {
            try {
                PomFile rootPom = fetchPomFromContents(owner, repo, "pom.xml", candidateBranch);
                if (rootPom != null) {
                    log.info("pom.xml resolved at root for {}/{}/{}", owner, repo, candidateBranch);
                    return rootPom;
                }
            } catch (Exception e) {
                log.warn("Root pom.xml lookup failed for {}/{}/{}: {}", owner, repo, candidateBranch, e.getMessage());
            }

            try {
                JsonNode pomBlob = findPomBlobInTree(owner, repo, candidateBranch);
                if (pomBlob != null) {
                    String path = pomBlob.path("path").asText();
                    String sha = pomBlob.path("sha").asText();
                    String pomXml = fetchBlobContent(owner, repo, sha);
                    log.info("pom.xml resolved via tree scan for {}/{}/{} at {}", owner, repo, candidateBranch, path);
                    return new PomFile(path, sha, pomXml, candidateBranch);
                }
            } catch (Exception e) {
                log.warn("Tree scan failed for {}/{}/{}: {}", owner, repo, candidateBranch, e.getMessage());
            }
        }

        throw new ResponseStatusException(NOT_FOUND,
                "pom.xml not found in " + owner + "/" + repo + " on branches: " + String.join(", ", candidateBranches));
    }

    private List<String> buildCandidateBranches(String owner, String repo, String requestedBranch) {
        Set<String> seen = new HashSet<>();
        List<String> branches = new ArrayList<>();

        addBranchCandidate(branches, seen, requestedBranch);

        try {
            JsonNode repoNode = restClient.get()
                    .uri("https://api.github.com/repos/{owner}/{repo}", owner, repo)
                    .header("Authorization", "Bearer " + getToken())
                    .header("Accept", "application/vnd.github+json")
                    .retrieve()
                    .body(JsonNode.class);
            if (repoNode != null) {
                addBranchCandidate(branches, seen, repoNode.path("default_branch").asText());
            }
        } catch (Exception e) {
            log.warn("Failed to read default branch for {}/{}: {}", owner, repo, e.getMessage());
        }

        addBranchCandidate(branches, seen, "main");
        addBranchCandidate(branches, seen, "master");
        return branches;
    }

    private void addBranchCandidate(List<String> branches, Set<String> seen, String branch) {
        String normalized = blankToNull(branch);
        if (normalized != null && seen.add(normalized)) {
            branches.add(normalized);
        }
    }

    private PomFile fetchPomFromContents(String owner, String repo, String path, String branch) {
        JsonNode fileNode = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/contents/" + path + "?ref={branch}", owner, repo, branch)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);

        if (fileNode == null || fileNode.path("content").isMissingNode()) {
            return null;
        }

        String encoded = fileNode.path("content").asText().replace("\n", "");
        byte[] decoded = Base64.getDecoder().decode(encoded);
        String pomXml = new String(decoded, StandardCharsets.UTF_8);
        return new PomFile(
                fileNode.path("path").asText(path),
                fileNode.path("sha").asText(),
                pomXml,
                branch
        );
    }

    private List<PomFile> fetchAllPomFiles(String owner, String repo, String branch) {
        List<String> pomPaths = findPomPathsInTree(owner, repo, branch);
        List<PomFile> pomFiles = new ArrayList<>();
        for (String path : pomPaths) {
            PomFile pomFile = fetchPomFromContents(owner, repo, path, branch);
            if (pomFile != null) {
                pomFiles.add(pomFile);
            }
        }

        if (pomFiles.isEmpty()) {
            PomFile rootPom = fetchPomFromContents(owner, repo, "pom.xml", branch);
            if (rootPom != null) {
                pomFiles.add(rootPom);
            }
        }

        return pomFiles;
    }

    private List<String> findPomPathsInTree(String owner, String repo, String branch) {
        JsonNode tree = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1", owner, repo, branch)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);

        if (tree == null || !tree.path("tree").isArray()) {
            return new ArrayList<>();
        }

        List<String> pomPaths = new ArrayList<>();
        for (JsonNode node : tree.path("tree")) {
            String type = node.path("type").asText();
            String path = node.path("path").asText();
            if ("blob".equals(type) && path.endsWith("pom.xml")) {
                pomPaths.add(path);
            }
        }

        pomPaths.sort((left, right) -> {
            int lengthCompare = Integer.compare(left.length(), right.length());
            return lengthCompare != 0 ? lengthCompare : left.compareTo(right);
        });
        return pomPaths;
    }

    private JsonNode findPomBlobInTree(String owner, String repo, String branch) {
        List<String> pomPaths = findPomPathsInTree(owner, repo, branch);
        if (pomPaths.isEmpty()) {
            return null;
        }

        String bestPath = pomPaths.get(0);
        JsonNode tree = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1", owner, repo, branch)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);
        if (tree == null || !tree.path("tree").isArray()) {
            return null;
        }

        for (JsonNode node : tree.path("tree")) {
            if ("blob".equals(node.path("type").asText()) && bestPath.equals(node.path("path").asText())) {
                return node;
            }
        }
        return null;
    }

    private int updateAdditionalPomFilesForReleaseCut(
            String owner,
            String repo,
            String branch,
            String primaryPomPath,
            String jiraTicket,
            String releaseVersion) {
        int updatedFiles = 0;
        List<PomFile> pomFiles = fetchAllPomFiles(owner, repo, branch);
        for (PomFile pomFile : pomFiles) {
            if (pomFile.path().equals(primaryPomPath)) {
                continue;
            }

            String updatedPom = removeSnapshotSuffixesFromPom(pomFile.content());
            if (updatedPom.equals(pomFile.content())) {
                continue;
            }

            updateTextFile(
                    owner,
                    repo,
                    pomFile.path(),
                    pomFile.sha(),
                    branch,
                    updatedPom,
                    buildReleaseCutCommitMessage(jiraTicket, releaseVersion) + " (" + pomFile.path() + ")");
            updatedFiles++;
        }
        return updatedFiles;
    }

    private String fetchBlobContent(String owner, String repo, String sha) {
        JsonNode blobNode = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/git/blobs/{sha}", owner, repo, sha)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);

        if (blobNode == null || blobNode.path("content").isMissingNode()) {
            throw new ResponseStatusException(NOT_FOUND, "Git blob content not found");
        }

        String encoded = blobNode.path("content").asText().replace("\n", "");
        byte[] decoded = Base64.getDecoder().decode(encoded);
        return new String(decoded, StandardCharsets.UTF_8);
    }

    private GitRef fetchBranchRef(String owner, String repo, String requestedBranch) {
        List<String> candidateBranches = buildCandidateBranches(owner, repo, requestedBranch);
        for (String candidateBranch : candidateBranches) {
            try {
                JsonNode refNode = restClient.get()
                        .uri("https://api.github.com/repos/{owner}/{repo}/git/ref/heads/{branch}", owner, repo, candidateBranch)
                        .header("Authorization", "Bearer " + getToken())
                        .header("Accept", "application/vnd.github+json")
                        .retrieve()
                        .body(JsonNode.class);

                if (refNode != null && !refNode.path("object").path("sha").isMissingNode()) {
                    return new GitRef(candidateBranch, refNode.path("object").path("sha").asText());
                }
            } catch (Exception e) {
                log.warn("Failed to resolve branch ref for {}/{}/{}: {}", owner, repo, candidateBranch, e.getMessage());
            }
        }
        throw new ResponseStatusException(NOT_FOUND, "Could not find source branch ref for " + requestedBranch);
    }

    private String updatePomVersions(String pomXml, String targetSpringBootVersion, String targetSnapshotVersion) {
        try {
            Document doc = DocumentBuilderFactory.newInstance()
                    .newDocumentBuilder()
                    .parse(new ByteArrayInputStream(pomXml.getBytes(StandardCharsets.UTF_8)));
            doc.getDocumentElement().normalize();

            String updatedXml = pomXml;

            if (targetSpringBootVersion != null) {
                String springBootRef = findSpringBootParentVersion(doc);
                if (springBootRef == null || springBootRef.isBlank()) {
                    throw new ResponseStatusException(NOT_FOUND, "Spring Boot parent not found in pom.xml");
                }

                String propertyName = extractPropertyName(springBootRef);
                if (propertyName != null) {
                    updatedXml = replacePropertyValue(updatedXml, propertyName, targetSpringBootVersion);
                } else {
                    updatedXml = replaceSpringBootParentVersion(updatedXml, springBootRef, targetSpringBootVersion);
                }
            }

            if (targetSnapshotVersion != null) {
                String projectVersionRef = findProjectVersion(doc);
                if (projectVersionRef == null || projectVersionRef.isBlank()) {
                    throw new ResponseStatusException(NOT_FOUND, "Project version element not found in pom.xml");
                }

                String propertyName = extractPropertyName(projectVersionRef);
                if (propertyName != null) {
                    updatedXml = replacePropertyValue(updatedXml, propertyName, targetSnapshotVersion);
                } else {
                    updatedXml = replaceProjectVersion(updatedXml, projectVersionRef, targetSnapshotVersion);
                }
            }

            return updatedXml;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to update pom.xml: " + e.getMessage());
        }
    }

    private String removeSnapshotSuffixesFromPom(String pomXml) {
        String withoutVersionSnapshots = removeSnapshotFromVersionTags(pomXml);
        return removeSnapshotFromPropertiesBlock(withoutVersionSnapshots);
    }

    private String removeSnapshotFromVersionTags(String xml) {
        Pattern versionPattern = Pattern.compile("(?s)<version>(.*?)</version>");
        Matcher matcher = versionPattern.matcher(xml);
        StringBuilder result = new StringBuilder();
        int lastIndex = 0;

        while (matcher.find()) {
            result.append(xml, lastIndex, matcher.start());

            String originalInside = matcher.group(1);
            String trimmedInside = originalInside.trim();
            String updatedInside = trimmedInside.contains("-SNAPSHOT")
                    ? trimmedInside.replace("-SNAPSHOT", "")
                    : trimmedInside;

            result.append("<version>")
                    .append(replaceKeepingEdgeWhitespace(originalInside, updatedInside))
                    .append("</version>");

            lastIndex = matcher.end();
        }

        result.append(xml.substring(lastIndex));
        return result.toString();
    }

    private String removeSnapshotFromPropertiesBlock(String xml) {
        Pattern propertiesPattern = Pattern.compile("(?s)<properties>(.*?)</properties>");
        Matcher propertiesMatcher = propertiesPattern.matcher(xml);
        if (!propertiesMatcher.find()) {
            return xml;
        }

        String propertiesContent = propertiesMatcher.group(1);
        Pattern propertyPattern = Pattern.compile("(?s)<([a-zA-Z0-9_.-]+)>(.*?)</\\1>");
        Matcher propertyMatcher = propertyPattern.matcher(propertiesContent);

        StringBuilder updatedProperties = new StringBuilder();
        int lastIndex = 0;
        while (propertyMatcher.find()) {
            updatedProperties.append(propertiesContent, lastIndex, propertyMatcher.start());

            String tagName = propertyMatcher.group(1);
            String originalInside = propertyMatcher.group(2);
            String trimmedInside = originalInside.trim();
            String updatedInside = trimmedInside.contains("-SNAPSHOT")
                    ? trimmedInside.replace("-SNAPSHOT", "")
                    : trimmedInside;

            updatedProperties.append("<")
                    .append(tagName)
                    .append(">")
                    .append(replaceKeepingEdgeWhitespace(originalInside, updatedInside))
                    .append("</")
                    .append(tagName)
                    .append(">");

            lastIndex = propertyMatcher.end();
        }

        updatedProperties.append(propertiesContent.substring(lastIndex));

        return xml.substring(0, propertiesMatcher.start(1))
                + updatedProperties
                + xml.substring(propertiesMatcher.end(1));
    }

    private List<Map<String, String>> findPomSnapshotFindings(String pomPath, String pomXml) {
        List<Map<String, String>> findings = new ArrayList<>();

        try {
            Document doc = DocumentBuilderFactory.newInstance()
                    .newDocumentBuilder()
                    .parse(new ByteArrayInputStream(pomXml.getBytes(StandardCharsets.UTF_8)));
            doc.getDocumentElement().normalize();

            Node projectVersionNode = findProjectVersionNode(doc);
            if (projectVersionNode != null) {
                String value = projectVersionNode.getTextContent().trim();
                if (value.contains("-SNAPSHOT")) {
                    findings.add(buildSnapshotFinding(pomPath, pomXml, "project.version", value));
                }
            }

            NodeList parents = doc.getElementsByTagName("parent");
            if (parents.getLength() > 0) {
                Element parent = (Element) parents.item(0);
                String groupId = getDirectChildText(parent, "groupId");
                String artifactId = getDirectChildText(parent, "artifactId");
                String version = getDirectChildText(parent, "version");
                if (version.contains("-SNAPSHOT")) {
                    String key = "parent:" + coalesceCoordinate(groupId, artifactId);
                    findings.add(buildSnapshotFinding(pomPath, pomXml, key, version));
                }
            }

            NodeList dependencies = doc.getElementsByTagName("dependency");
            for (int i = 0; i < dependencies.getLength(); i++) {
                Element dependency = (Element) dependencies.item(i);
                String version = getDirectChildText(dependency, "version");
                if (!version.contains("-SNAPSHOT")) {
                    continue;
                }

                String groupId = getDirectChildText(dependency, "groupId");
                String artifactId = getDirectChildText(dependency, "artifactId");
                String key = "dependency:" + coalesceCoordinate(groupId, artifactId);
                findings.add(buildSnapshotFinding(pomPath, pomXml, key, version));
            }

            NodeList plugins = doc.getElementsByTagName("plugin");
            for (int i = 0; i < plugins.getLength(); i++) {
                Element plugin = (Element) plugins.item(i);
                String version = getDirectChildText(plugin, "version");
                if (!version.contains("-SNAPSHOT")) {
                    continue;
                }

                String groupId = getDirectChildText(plugin, "groupId");
                String artifactId = getDirectChildText(plugin, "artifactId");
                String key = "plugin:" + coalesceCoordinate(groupId, artifactId);
                findings.add(buildSnapshotFinding(pomPath, pomXml, key, version));
            }

            NodeList propertiesNodes = doc.getElementsByTagName("properties");
            if (propertiesNodes.getLength() > 0) {
                NodeList children = propertiesNodes.item(0).getChildNodes();
                for (int i = 0; i < children.getLength(); i++) {
                    Node node = children.item(i);
                    if (node.getNodeType() != Node.ELEMENT_NODE) {
                        continue;
                    }

                    String value = node.getTextContent().trim();
                    if (!value.contains("-SNAPSHOT")) {
                        continue;
                    }

                    String key = "property:" + node.getNodeName();
                    findings.add(buildSnapshotFinding(pomPath, pomXml, key, value));
                }
            }
        } catch (Exception e) {
            // Fallback to regex parsing so preview still works for malformed XML.
            Pattern versionPattern = Pattern.compile("(?s)<version>(.*?)</version>");
            Matcher versionMatcher = versionPattern.matcher(pomXml);
            while (versionMatcher.find()) {
                String value = versionMatcher.group(1).trim();
                if (!value.contains("-SNAPSHOT")) {
                    continue;
                }

                findings.add(buildSnapshotFinding(pomPath, pomXml, "project/dependency version", value));
            }
        }

        return findings;
    }

    private Map<String, String> buildSnapshotFinding(String filePath, String fullText, String field, String currentValue) {
        Map<String, String> row = new LinkedHashMap<>();
        row.put("filePath", filePath);
        row.put("line", String.valueOf(lineNumberForIndex(fullText, fullText.indexOf(currentValue))));
        row.put("field", field);
        row.put("currentValue", currentValue);
        row.put("newValue", currentValue.replace("-SNAPSHOT", ""));
        return row;
    }

    private String getDirectChildText(Element element, String childName) {
        NodeList children = element.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (node.getNodeType() == Node.ELEMENT_NODE && childName.equals(node.getNodeName())) {
                return node.getTextContent().trim();
            }
        }
        return "";
    }

    private String coalesceCoordinate(String groupId, String artifactId) {
        String group = blankToNull(groupId);
        String artifact = blankToNull(artifactId);
        if (group == null && artifact == null) {
            return "unknown";
        }
        if (group == null) {
            return artifact;
        }
        if (artifact == null) {
            return group;
        }
        return group + ":" + artifact;
    }

    private List<Map<String, String>> findDockerVersionTagSnapshotFindings(String workflowPath, String workflowContent) {
        List<Map<String, String>> findings = new ArrayList<>();

        Pattern pattern = Pattern.compile("(?m)^(\\s*VERSION_TAG\\s*:\\s*\"?)([^\"\\r\\n]+)(\"?\\s*)$");
        Matcher matcher = pattern.matcher(workflowContent);
        while (matcher.find()) {
            String current = matcher.group(2).trim();
            if (!current.contains("-SNAPSHOT")) {
                continue;
            }

            Map<String, String> row = new LinkedHashMap<>();
            row.put("filePath", workflowPath);
            row.put("line", String.valueOf(lineNumberForIndex(workflowContent, matcher.start(2))));
            row.put("field", "VERSION_TAG");
            row.put("currentValue", current);
            row.put("newValue", current.replace("-SNAPSHOT", ""));
            findings.add(row);
        }

        return findings;
    }

    private int lineNumberForIndex(String text, int index) {
        int line = 1;
        for (int i = 0; i < index && i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                line++;
            }
        }
        return line;
    }

    private String replacePropertyValue(String xml, String propertyName, String targetValue) {
        String openTag = "<" + propertyName + ">";
        String closeTag = "</" + propertyName + ">";

        int startTagIndex = xml.indexOf(openTag);
        if (startTagIndex < 0) {
            throw new ResponseStatusException(NOT_FOUND, "Property " + propertyName + " not found in pom.xml");
        }

        int valueStart = startTagIndex + openTag.length();
        int valueEnd = xml.indexOf(closeTag, valueStart);
        if (valueEnd < 0) {
            throw new ResponseStatusException(NOT_FOUND, "Property " + propertyName + " closing tag not found in pom.xml");
        }

        String current = xml.substring(valueStart, valueEnd);
        String trimmed = current.trim();
        int leading = current.indexOf(trimmed);
        if (leading < 0) {
            return xml.substring(0, valueStart) + targetValue + xml.substring(valueEnd);
        }
        int trailingStart = leading + trimmed.length();
        String replacement = current.substring(0, leading) + targetValue + current.substring(trailingStart);

        return xml.substring(0, valueStart) + replacement + xml.substring(valueEnd);
    }

    private String replaceSpringBootParentVersion(String xml, String currentVersion, String targetVersion) {
        Pattern parentPattern = Pattern.compile("(?s)<parent>.*?</parent>");
        Matcher parentMatcher = parentPattern.matcher(xml);

        while (parentMatcher.find()) {
            String parentBlock = parentMatcher.group();
            if (!parentBlock.contains("springframework.boot")) {
                continue;
            }

            Pattern versionPattern = Pattern.compile("(?s)<version>(.*?)</version>");
            Matcher versionMatcher = versionPattern.matcher(parentBlock);
            if (!versionMatcher.find()) {
                break;
            }

            String inside = versionMatcher.group(1);
            if (!inside.trim().equals(currentVersion)) {
                break;
            }

            String replacedInside = replaceKeepingEdgeWhitespace(inside, targetVersion);
            String replacedBlock = parentBlock.substring(0, versionMatcher.start(1))
                    + replacedInside
                    + parentBlock.substring(versionMatcher.end(1));

            return xml.substring(0, parentMatcher.start())
                    + replacedBlock
                    + xml.substring(parentMatcher.end());
        }

        throw new ResponseStatusException(NOT_FOUND, "Spring Boot parent version element not found in pom.xml");
    }

    private String replaceProjectVersion(String xml, String currentVersion, String targetVersion) {
        Pattern versionPattern = Pattern.compile("(?s)<version>(.*?)</version>");
        Matcher matcher = versionPattern.matcher(xml);

        while (matcher.find()) {
            String inside = matcher.group(1);
            if (!inside.trim().equals(currentVersion)) {
                continue;
            }

            if (isInsideParentBlock(xml, matcher.start(), matcher.end())) {
                continue;
            }

            String replacedInside = replaceKeepingEdgeWhitespace(inside, targetVersion);
            return xml.substring(0, matcher.start(1))
                    + replacedInside
                    + xml.substring(matcher.end(1));
        }

        throw new ResponseStatusException(NOT_FOUND, "Project version element not found in pom.xml");
    }

    private boolean isInsideParentBlock(String xml, int start, int end) {
        Pattern parentPattern = Pattern.compile("(?s)<parent>.*?</parent>");
        Matcher parentMatcher = parentPattern.matcher(xml);
        while (parentMatcher.find()) {
            if (start >= parentMatcher.start() && end <= parentMatcher.end()) {
                return true;
            }
        }
        return false;
    }

    private String replaceKeepingEdgeWhitespace(String original, String replacement) {
        String trimmed = original.trim();
        if (trimmed.isEmpty()) {
            return replacement;
        }

        int leading = original.indexOf(trimmed);
        int trailingStart = leading + trimmed.length();
        return original.substring(0, leading) + replacement + original.substring(trailingStart);
    }

    private void updateSpringBootVersion(Document doc, String targetVersion) {
        NodeList parents = doc.getElementsByTagName("parent");
        for (int i = 0; i < parents.getLength(); i++) {
            Element parent = (Element) parents.item(i);
            NodeList groupIds = parent.getElementsByTagName("groupId");
            if (groupIds.getLength() == 0) {
                continue;
            }

            String groupId = groupIds.item(0).getTextContent().trim();
            if (!groupId.contains("springframework.boot")) {
                continue;
            }

            NodeList versions = parent.getElementsByTagName("version");
            if (versions.getLength() == 0) {
                throw new ResponseStatusException(NOT_FOUND, "Spring Boot parent version element not found");
            }

            updateNodeValue(doc, versions.item(0), targetVersion);
            return;
        }

        throw new ResponseStatusException(NOT_FOUND, "Spring Boot parent not found in pom.xml");
    }

    private void updateProjectVersion(Document doc, String targetVersion) {
        Node versionNode = findProjectVersionNode(doc);
        if (versionNode == null) {
            throw new ResponseStatusException(NOT_FOUND, "Project version element not found in pom.xml");
        }
        updateNodeValue(doc, versionNode, targetVersion);
    }

    private void updateNodeValue(Document doc, Node node, String targetValue) {
        String currentValue = node.getTextContent().trim();
        String propertyName = extractPropertyName(currentValue);
        if (propertyName != null) {
            Node propertyNode = findPropertyNode(doc, propertyName);
            if (propertyNode == null) {
                throw new ResponseStatusException(NOT_FOUND, "Property " + propertyName + " not found in pom.xml");
            }
            propertyNode.setTextContent(targetValue);
            return;
        }
        node.setTextContent(targetValue);
    }

    private Node findPropertyNode(Document doc, String propertyName) {
        NodeList propertiesNodes = doc.getElementsByTagName("properties");
        if (propertiesNodes.getLength() == 0) {
            return null;
        }
        NodeList children = propertiesNodes.item(0).getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node child = children.item(i);
            if (child.getNodeType() == Node.ELEMENT_NODE && propertyName.equals(child.getNodeName())) {
                return child;
            }
        }
        return null;
    }

    private String extractPropertyName(String value) {
        if (value != null && value.startsWith("${") && value.endsWith("}")) {
            return value.substring(2, value.length() - 1);
        }
        return null;
    }

    private Node findProjectVersionNode(Document doc) {
        NodeList rootChildren = doc.getDocumentElement().getChildNodes();
        for (int i = 0; i < rootChildren.getLength(); i++) {
            Node node = rootChildren.item(i);
            if (node.getNodeType() == Node.ELEMENT_NODE && "version".equals(node.getNodeName())) {
                return node;
            }
        }
        return null;
    }

    private String findProjectVersion(Document doc) {
        Node versionNode = findProjectVersionNode(doc);
        return versionNode == null ? "" : versionNode.getTextContent().trim();
    }

    private String findSpringBootParentVersion(Document doc) {
        NodeList parents = doc.getElementsByTagName("parent");
        for (int i = 0; i < parents.getLength(); i++) {
            Element parent = (Element) parents.item(i);
            NodeList groupIds = parent.getElementsByTagName("groupId");
            if (groupIds.getLength() == 0) {
                continue;
            }

            String groupId = groupIds.item(0).getTextContent().trim();
            if (!groupId.contains("springframework.boot")) {
                continue;
            }

            NodeList versions = parent.getElementsByTagName("version");
            if (versions.getLength() > 0) {
                return versions.item(0).getTextContent().trim();
            }
        }
        return "";
    }

    private String toXml(Document doc) {
        try {
            Transformer transformer = TransformerFactory.newInstance().newTransformer();
            transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "no");
            transformer.setOutputProperty(OutputKeys.INDENT, "yes");
            StringWriter writer = new StringWriter();
            transformer.transform(new DOMSource(doc), new StreamResult(writer));
            return writer.toString();
        } catch (Exception e) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to render pom.xml: " + e.getMessage());
        }
    }

    private JsonNode updatePomFile(String owner, String repo, String path, String sha, String branch, String pomXml, String commitMessage) {
        return updateTextFile(owner, repo, path, sha, branch, pomXml, commitMessage);
    }

    private JsonNode updateTextFile(String owner, String repo, String path, String sha, String branch, String content, String commitMessage) {
        String encodedContent = Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8));
        JsonNode response = restClient.put()
                .uri("https://api.github.com/repos/{owner}/{repo}/contents/" + path, owner, repo)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .body(Map.of(
                        "message", commitMessage,
                        "content", encodedContent,
                        "sha", sha,
                        "branch", branch
                ))
                .retrieve()
                .body(JsonNode.class);

        if (response == null || response.path("commit").isMissingNode()) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to commit updated file " + path);
        }
        return response;
    }

    private String buildReleaseCutCommitMessage(String jiraTicket, String releaseVersion) {
        StringBuilder message = new StringBuilder();
        if (jiraTicket != null) {
            message.append(jiraTicket).append(": ");
        }
        message.append("Release cut pom.xml to ").append(releaseVersion);
        return message.toString();
    }

    private String buildWorkflowCutCommitMessage(String jiraTicket, String releaseVersion) {
        StringBuilder message = new StringBuilder();
        if (jiraTicket != null) {
            message.append(jiraTicket).append(": ");
        }
        message.append("Release cut Docker workflow to ").append(releaseVersion);
        return message.toString();
    }

    private String buildReleaseCutPrTitle(String repo, String jiraTicket, String releaseVersion) {
        StringBuilder title = new StringBuilder();
        if (jiraTicket != null) {
            title.append(jiraTicket).append(": ");
        }
        title.append("Release cut ").append(repo).append(" ").append(releaseVersion);
        return title.toString();
    }

    private String buildReleaseCutPrBody(String pomPath, String currentVersion, String releaseVersion, String workflowPath) {
        StringBuilder body = new StringBuilder();
        body.append("Automated release cut proposal\n\n");
        body.append("Changes\n");
        body.append("- Created release branch: release/").append(releaseVersion).append("\n");
        body.append("- Updated ").append(pomPath).append(": ")
                .append(currentVersion).append(" -> ").append(releaseVersion).append("\n");
        body.append("- Removed -SNAPSHOT tags from pom.xml dependencies/properties\n");
        if (workflowPath != null && !workflowPath.isBlank()) {
            body.append("- Updated workflow: ").append(workflowPath).append("\n");
        }
        body.append("\nBase branch is the release branch and must not be merged back automatically.\n");
        return body.toString();
    }

    private void ensureBranchExists(String repoFullName, String sourceBranch, String targetBranch) {
        try {
            createBranch(repoFullName, sourceBranch, targetBranch);
        } catch (ResponseStatusException e) {
            String reason = blankToNull(e.getReason());
            if (reason != null && reason.toLowerCase(Locale.ROOT).contains("reference already exists")) {
                log.info("Branch already exists and will be reused: {}", targetBranch);
                return;
            }
            throw e;
        }
    }

    private boolean isWorkflowScopeForbidden(String message) {
        String text = blankToNull(message);
        if (text == null) {
            return false;
        }
        String normalized = text.toLowerCase(Locale.ROOT);
        return normalized.contains("workflow")
                && normalized.contains("scope")
                && normalized.contains(".github/workflows/docker.yml");
    }

    private boolean isNoCommitsBetweenError(String message) {
        String text = blankToNull(message);
        if (text == null) {
            return false;
        }
        return text.toLowerCase(Locale.ROOT).contains("no commits between");
    }

    private String resolveLastReleaseBranch(String repoFullName, String currentReleaseBranch) {
        List<String> branches = fetchRepoBranches(repoFullName);
        List<String> candidates = new ArrayList<>();

        for (String branch : branches) {
            if (isStrictReleaseVersionBranch(branch) && !branch.equals(currentReleaseBranch)) {
                candidates.add(branch);
            }
        }

        if (candidates.isEmpty()) {
            throw new ResponseStatusException(
                    BAD_REQUEST,
                    "No previous release branch found. Provide lastReleaseBranch in request.");
        }

        candidates.sort((left, right) -> compareReleaseBranchVersion(right, left));
        return candidates.get(0);
    }

    private boolean isStrictReleaseVersionBranch(String branch) {
        return branch != null && branch.matches("^release/\\d+(?:\\.\\d+)*$");
    }

    private int compareReleaseBranchVersion(String leftBranch, String rightBranch) {
        int[] left = parseReleaseVersionNumbers(leftBranch);
        int[] right = parseReleaseVersionNumbers(rightBranch);
        int max = Math.max(left.length, right.length);

        for (int i = 0; i < max; i++) {
            int leftPart = i < left.length ? left[i] : 0;
            int rightPart = i < right.length ? right[i] : 0;
            if (leftPart != rightPart) {
                return Integer.compare(leftPart, rightPart);
            }
        }

        return 0;
    }

    private int[] parseReleaseVersionNumbers(String releaseBranch) {
        String version = releaseBranch == null ? "" : releaseBranch.replaceFirst("^release/", "");
        String[] parts = version.split("\\.");
        int[] numbers = new int[parts.length];

        for (int i = 0; i < parts.length; i++) {
            String digits = parts[i].replaceAll("[^0-9]", "");
            if (digits.isEmpty()) {
                numbers[i] = 0;
                continue;
            }

            try {
                numbers[i] = Integer.parseInt(digits);
            } catch (NumberFormatException e) {
                numbers[i] = 0;
            }
        }

        return numbers;
    }

    private Map<String, String> findExistingPullRequest(String owner, String repo, String baseBranch, String headBranch) {
        JsonNode response = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/pulls?state=open&base={base}&head={owner}:{head}",
                        owner, repo, baseBranch, owner, headBranch)
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

    private String buildCommitMessage(String targetSpringBootVersion, String targetSnapshotVersion, String jiraTicket) {
        StringBuilder message = new StringBuilder();
        if (jiraTicket != null) {
            message.append(jiraTicket).append(": ");
        }
        message.append("Update Spring Boot upgrade plan");
        if (targetSpringBootVersion != null) {
            message.append(" to ").append(targetSpringBootVersion);
        }
        if (targetSnapshotVersion != null) {
            message.append(" and snapshot ").append(targetSnapshotVersion);
        }
        return message.toString();
    }

    private String buildPrTitle(String repo, String targetSpringBootVersion, String targetSnapshotVersion, String jiraTicket) {
        StringBuilder title = new StringBuilder();
        if (jiraTicket != null) {
            title.append(jiraTicket).append(": ");
        }
        title.append("Upgrade ").append(repo);
        if (targetSpringBootVersion != null) {
            title.append(" to Spring Boot ").append(targetSpringBootVersion);
        }
        if (targetSnapshotVersion != null) {
            title.append(" / ").append(targetSnapshotVersion);
        }
        return title.toString();
    }

    private String buildPrBody(
            Map<String, String> currentVersions,
            String targetSpringBootVersion,
            String targetSnapshotVersion,
            String jiraTicket,
            String pomPath,
            String sourceBranch) {
        StringBuilder body = new StringBuilder();
        body.append("Automated upgrade proposal\n\n");
        body.append("Source branch: ").append(sourceBranch).append("\n");
        body.append("Updated file: ").append(pomPath).append("\n\n");
        body.append("Changes\n");
        if (targetSpringBootVersion != null) {
            body.append("- Spring Boot: ")
                    .append(currentVersions.getOrDefault("springBootVersion", "N/A"))
                    .append(" -> ")
                    .append(targetSpringBootVersion)
                    .append("\n");
        }
        if (targetSnapshotVersion != null) {
            body.append("- Snapshot: ")
                    .append(currentVersions.getOrDefault("snapshotVersion", "N/A"))
                    .append(" -> ")
                    .append(targetSnapshotVersion)
                    .append("\n");
        }
        if (jiraTicket != null) {
            body.append("\nJira: ").append(jiraTicket).append("\n");
        }
        return body.toString();
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

    private String resolve(String value, Map<String, String> props) {
        if (value == null || value.isBlank()) {
            return "";
        }
        if (value.startsWith("${") && value.endsWith("}")) {
            String key = value.substring(2, value.length() - 1);
            return props.getOrDefault(key, value);
        }
        return value;
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
                    + "GITHUB_PERSONAL_TOKEN and restart backend."
            );
        }
        return token;
    }
}
