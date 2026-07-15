package com.marathas.utility.backend.service;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import com.fasterxml.jackson.databind.JsonNode;
import com.marathas.utility.backend.config.GithubOAuthProperties;

@Service
public class SnapshotUpgradeService {

    private static final Logger log = LoggerFactory.getLogger(SnapshotUpgradeService.class);
    private static final Pattern DOCKER_VERSION_TAG_PATTERN = Pattern.compile(
            "(?m)^(\\s*VERSION_TAG\\s*:\\s*)([\"']?)([^\\r\\n]*?)(\\2)(\\s*(?:#.*)?)$");
    private static final Pattern SNAPSHOT_VERSION_IN_TAG_PATTERN = Pattern.compile(
            "\\d+(?:\\.\\d+){1,3}(?:[-A-Za-z0-9._]*)?-SNAPSHOT");
    private static final Pattern GENERIC_VERSION_IN_TAG_PATTERN = Pattern.compile(
            "\\d+(?:\\.\\d+){1,3}(?:[-A-Za-z0-9._]*)?");
        private static final Pattern BASE_VERSION_PATTERN = Pattern.compile("\\d+(?:\\.\\d+){1,3}");

    private record RepoTextFile(String path, String sha, String content, String branch) {
    }

    private record GitRef(String branch, String sha) {
    }

    private final RestClient restClient;
    private final GithubOAuthProperties properties;
    private final GithubPullRequestService githubPullRequestService;

    public SnapshotUpgradeService(
            RestClient.Builder restClientBuilder,
            GithubOAuthProperties properties,
            GithubPullRequestService githubPullRequestService) {
        this.restClient = restClientBuilder.build();
        this.properties = properties;
        this.githubPullRequestService = githubPullRequestService;
    }

    public Map<String, Object> previewSnapshotUpgrade(Map<String, String> request) {
        String repoFullName = requireValue(request.get("repoFullName"), "repoFullName");
        String sourceBranch = normalizeBranch(request.get("sourceBranch"), "master");
        String targetSnapshotVersion = requireValue(request.get("targetSnapshotVersion"), "targetSnapshotVersion");

        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];

        List<RepoTextFile> pomFiles = fetchAllPomFiles(owner, repo, sourceBranch);
        if (pomFiles.isEmpty()) {
            throw new ResponseStatusException(NOT_FOUND, "No pom.xml files found in repository");
        }

        List<Map<String, String>> pomFindings = new ArrayList<>();
        for (RepoTextFile pomFile : pomFiles) {
            String updated = updatePomSnapshotVersions(pomFile.content(), targetSnapshotVersion);
            if (updated.equals(pomFile.content())) {
                continue;
            }
            pomFindings.addAll(buildPomSnapshotFindings(pomFile.path(), pomFile.content(), updated));
        }

        List<Map<String, String>> dockerFindings = new ArrayList<>();
        String dockerWorkflowPath = "";
        try {
            RepoTextFile dockerWorkflow = fetchDockerWorkflow(owner, repo, sourceBranch);
            dockerWorkflowPath = dockerWorkflow.path();
            String updatedDocker = updateDockerWorkflowSnapshotTag(dockerWorkflow.content(), targetSnapshotVersion);
            if (!updatedDocker.equals(dockerWorkflow.content())) {
                dockerFindings = buildDockerSnapshotFindings(dockerWorkflow.path(), dockerWorkflow.content(), updatedDocker);
            }
        } catch (ResponseStatusException e) {
            // Keep preview usable even when workflow file does not exist.
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sourceBranch", sourceBranch);
        result.put("targetSnapshotVersion", targetSnapshotVersion);
        result.put("pomFilesScanned", pomFiles.size());
        result.put("dockerWorkflowPath", dockerWorkflowPath);
        result.put("pomSnapshotFindings", pomFindings);
        result.put("dockerSnapshotFindings", dockerFindings);
        result.put("totalSnapshotFindings", pomFindings.size() + dockerFindings.size());
        return result;
    }

    public Map<String, String> applySnapshotUpgrade(Map<String, String> request) {
        String repoFullName = requireValue(request.get("repoFullName"), "repoFullName");
        String sourceBranch = normalizeBranch(request.get("sourceBranch"), "master");
        String baseBranch = normalizeBranch(request.get("baseBranch"), sourceBranch);
        String targetSnapshotVersion = requireValue(request.get("targetSnapshotVersion"), "targetSnapshotVersion");
        String jiraTicket = blankToNull(request.get("jiraTicket"));
        Set<String> selectedFindingIds = parseSelectedFindingIds(request.get("selectedFindingIds"));

        boolean useNewBranch = parseBoolean(request.get("useNewBranch"), true);
        boolean createPullRequest = parseBoolean(request.get("createPullRequest"), false);

        String requestedBranchName = blankToNull(request.get("branchName"));
        String workingBranch = useNewBranch
                ? (requestedBranchName == null ? buildDefaultBranchName(repoFullName, jiraTicket, targetSnapshotVersion) : requestedBranchName)
                : sourceBranch;

        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];

        if (useNewBranch) {
            ensureBranchExists(repoFullName, sourceBranch, workingBranch);
        }

        List<RepoTextFile> pomFiles = fetchAllPomFiles(owner, repo, workingBranch);
        if (pomFiles.isEmpty()) {
            throw new ResponseStatusException(NOT_FOUND, "No pom.xml files found in repository");
        }

        int pomFilesUpdated = 0;
        String lastPomCommitSha = "";
        for (RepoTextFile pomFile : pomFiles) {
            String fullUpdatedPom = updatePomSnapshotVersions(pomFile.content(), targetSnapshotVersion);
            List<Map<String, String>> pomFindings = buildPomSnapshotFindings(pomFile.path(), pomFile.content(), fullUpdatedPom);
            String updatedPom = applySelectedFindings(pomFile.content(), fullUpdatedPom, pomFindings, selectedFindingIds);
            if (updatedPom.equals(pomFile.content())) {
                continue;
            }

            JsonNode commit = updateTextFile(
                    owner,
                    repo,
                    pomFile.path(),
                    pomFile.sha(),
                    workingBranch,
                    updatedPom,
                    buildSnapshotCommitMessage(jiraTicket, targetSnapshotVersion, pomFile.path()));

            lastPomCommitSha = commit.path("commit").path("sha").asText("");
            pomFilesUpdated++;
        }

        int dockerFilesUpdated = 0;
        String dockerWorkflowPath = "";
        String dockerCommitSha = "";
        try {
            RepoTextFile dockerWorkflow = fetchDockerWorkflow(owner, repo, workingBranch);
            String fullUpdatedDocker = updateDockerWorkflowSnapshotTag(dockerWorkflow.content(), targetSnapshotVersion);
            List<Map<String, String>> dockerFindings = buildDockerSnapshotFindings(
                    dockerWorkflow.path(),
                    dockerWorkflow.content(),
                    fullUpdatedDocker);
            String updatedDocker = applySelectedFindings(dockerWorkflow.content(), fullUpdatedDocker, dockerFindings, selectedFindingIds);
            if (!updatedDocker.equals(dockerWorkflow.content())) {
                JsonNode dockerCommit = updateTextFile(
                        owner,
                        repo,
                        dockerWorkflow.path(),
                        dockerWorkflow.sha(),
                        workingBranch,
                        updatedDocker,
                        buildSnapshotDockerCommitMessage(jiraTicket, targetSnapshotVersion));
                dockerFilesUpdated = 1;
                dockerWorkflowPath = dockerWorkflow.path();
                dockerCommitSha = dockerCommit.path("commit").path("sha").asText("");
            }
        } catch (ResponseStatusException e) {
            // Docker workflow is optional for snapshot upgrades.
        }

        if (pomFilesUpdated == 0 && dockerFilesUpdated == 0) {
            throw new ResponseStatusException(
                    BAD_REQUEST,
                    "No snapshot changes detected. Preview changes and verify target snapshot version.");
        }

        String prUrl = "";
        String prNumber = "";
        String prCreated = "false";
        String prExisting = "false";

        if (createPullRequest) {
            String prTitle = buildSnapshotPrTitle(repo, jiraTicket, targetSnapshotVersion);
            String prBody = buildSnapshotPrBody(sourceBranch, workingBranch, targetSnapshotVersion, pomFilesUpdated, dockerWorkflowPath);

            Map<String, String> prResult = githubPullRequestService.createPullRequest(
                    repoFullName,
                    baseBranch,
                    workingBranch,
                    prTitle,
                    prBody);

            prUrl = prResult.getOrDefault("prUrl", "");
            prNumber = prResult.getOrDefault("prNumber", "");
            prCreated = prResult.getOrDefault("created", "false");
            prExisting = prResult.getOrDefault("existing", "false");
        }

        Map<String, String> result = new LinkedHashMap<>();
        result.put("sourceBranch", sourceBranch);
        result.put("baseBranch", baseBranch);
        result.put("branchName", workingBranch);
        result.put("useNewBranch", String.valueOf(useNewBranch));
        result.put("createPullRequest", String.valueOf(createPullRequest));
        result.put("targetSnapshotVersion", targetSnapshotVersion);
        result.put("pomFilesUpdated", String.valueOf(pomFilesUpdated));
        result.put("dockerFilesUpdated", String.valueOf(dockerFilesUpdated));
        result.put("lastPomCommitSha", lastPomCommitSha);
        result.put("dockerWorkflowPath", dockerWorkflowPath);
        result.put("dockerCommitSha", dockerCommitSha);
        result.put("prUrl", prUrl);
        result.put("prNumber", prNumber);
        result.put("prCreated", prCreated);
        result.put("prExisting", prExisting);
        return result;
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

    private RepoTextFile fetchDockerWorkflow(String owner, String repo, String branch) {
        try {
            return fetchTextFileFromContents(owner, repo, ".github/workflows/Docker.yml", branch);
        } catch (ResponseStatusException ignored) {
            // Fallback to repository-specific docker workflow naming.
        }

        String workflowPath = findDockerWorkflowPathInTree(owner, repo, branch);
        if (workflowPath == null) {
            throw new ResponseStatusException(NOT_FOUND, "Docker workflow file not found under .github/workflows");
        }

        return fetchTextFileFromContents(owner, repo, workflowPath, branch);
    }

    private String findDockerWorkflowPathInTree(String owner, String repo, String branch) {
        JsonNode tree = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1", owner, repo, branch)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);

        if (tree == null || !tree.path("tree").isArray()) {
            return null;
        }

        String bestMatch = null;
        for (JsonNode node : tree.path("tree")) {
            if (!"blob".equals(node.path("type").asText(""))) {
                continue;
            }

            String path = node.path("path").asText("");
            String normalizedPath = path.toLowerCase(Locale.ROOT);
            if (!normalizedPath.startsWith(".github/workflows/")) {
                continue;
            }

            boolean isYaml = normalizedPath.endsWith(".yml") || normalizedPath.endsWith(".yaml");
            if (!isYaml || !normalizedPath.contains("docker")) {
                continue;
            }

            if (bestMatch == null || path.length() < bestMatch.length()) {
                bestMatch = path;
            }
        }

        return bestMatch;
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

    private List<RepoTextFile> fetchAllPomFiles(String owner, String repo, String branch) {
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
            if (!"blob".equals(node.path("type").asText(""))) {
                continue;
            }
            String path = node.path("path").asText("");
            if (path.endsWith("pom.xml")) {
                pomPaths.add(path);
            }
        }

        pomPaths.sort((left, right) -> {
            int lengthCompare = Integer.compare(left.length(), right.length());
            return lengthCompare != 0 ? lengthCompare : left.compareTo(right);
        });

        List<RepoTextFile> pomFiles = new ArrayList<>();
        for (String path : pomPaths) {
            try {
                RepoTextFile pom = fetchTextFileFromContents(owner, repo, path, branch);
                pomFiles.add(pom);
            } catch (ResponseStatusException e) {
                log.warn("Skipping unreadable pom file {}: {}", path, e.getReason());
            }
        }

        return pomFiles;
    }

    private String updatePomSnapshotVersions(String pomXml, String targetSnapshotVersion) {
        String normalizedTarget = requireValue(targetSnapshotVersion, "targetSnapshotVersion");

        String updated = replaceProjectVersionTag(pomXml, normalizedTarget);
        updated = replaceSnapshotVersionTags(updated, normalizedTarget);
        updated = replaceSnapshotPropertyTags(updated, normalizedTarget);
        return updated;
    }

    private String replaceProjectVersionTag(String xml, String targetSnapshotVersion) {
        Pattern projectVersionPattern = Pattern.compile("(?s)<project\\b[^>]*>.*?<version>(.*?)</version>");
        Matcher matcher = projectVersionPattern.matcher(xml);
        if (!matcher.find()) {
            return xml;
        }

        String originalInside = matcher.group(1);
        if (!originalInside.trim().contains("-SNAPSHOT")) {
            return xml;
        }
        String replacedSnapshotVersion = determineSnapshotReplacement(originalInside.trim(), targetSnapshotVersion);
        String replacedInside = replaceKeepingEdgeWhitespace(originalInside, replacedSnapshotVersion);

        int contentStart = matcher.start(1);
        int contentEnd = matcher.end(1);
        return xml.substring(0, contentStart) + replacedInside + xml.substring(contentEnd);
    }

    private String replaceSnapshotVersionTags(String xml, String targetSnapshotVersion) {
        Pattern versionPattern = Pattern.compile("(?s)<version>(.*?)</version>");
        Matcher matcher = versionPattern.matcher(xml);
        StringBuilder result = new StringBuilder();
        int lastIndex = 0;

        while (matcher.find()) {
            result.append(xml, lastIndex, matcher.start());

            String originalInside = matcher.group(1);
            String trimmedInside = originalInside.trim();
            String updatedInside = trimmedInside.contains("-SNAPSHOT")
                    ? determineSnapshotReplacement(trimmedInside, targetSnapshotVersion)
                    : trimmedInside;

            result.append("<version>")
                    .append(replaceKeepingEdgeWhitespace(originalInside, updatedInside))
                    .append("</version>");

            lastIndex = matcher.end();
        }

        result.append(xml.substring(lastIndex));
        return result.toString();
    }

    private String replaceSnapshotPropertyTags(String xml, String targetSnapshotVersion) {
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
                    ? determineSnapshotReplacement(trimmedInside, targetSnapshotVersion)
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

    private String updateDockerWorkflowSnapshotTag(String workflowContent, String targetSnapshotVersion) {
        Matcher matcher = DOCKER_VERSION_TAG_PATTERN.matcher(workflowContent);
        StringBuffer sb = new StringBuffer();
        while (matcher.find()) {
            String currentValue = matcher.group(3).trim();
            String updatedValue = updateDockerTagValue(currentValue, targetSnapshotVersion);
            String replacement = matcher.group(1)
                    + matcher.group(2)
                    + Matcher.quoteReplacement(updatedValue)
                    + matcher.group(4)
                    + matcher.group(5);
            matcher.appendReplacement(sb, replacement);
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private List<Map<String, String>> buildPomSnapshotFindings(String filePath, String original, String updated) {
        List<Map<String, String>> findings = new ArrayList<>();

        Pattern linePattern = Pattern.compile("(?m)^.*$\n?");
        Matcher originalLines = linePattern.matcher(original);
        Matcher updatedLines = linePattern.matcher(updated);

        int line = 1;
        while (originalLines.find() && updatedLines.find()) {
            String oldLine = originalLines.group();
            String newLine = updatedLines.group();
            if (!oldLine.equals(newLine)) {
                Map<String, String> row = new LinkedHashMap<>();
                row.put("filePath", filePath);
                row.put("line", String.valueOf(line));
                row.put("field", "pom.xml");
                row.put("currentValue", oldLine.trim());
                row.put("newValue", newLine.trim());
                row.put("findingId", buildFindingId(filePath, line, "pom.xml", oldLine.trim()));
                findings.add(row);
            }
            line++;
        }

        return findings;
    }

    private List<Map<String, String>> buildDockerSnapshotFindings(String filePath, String original, String updated) {
        List<Map<String, String>> findings = new ArrayList<>();

        Matcher oldMatcher = DOCKER_VERSION_TAG_PATTERN.matcher(original);
        Matcher newMatcher = DOCKER_VERSION_TAG_PATTERN.matcher(updated);

        while (oldMatcher.find() && newMatcher.find()) {
            String oldValue = oldMatcher.group(3).trim();
            String newValue = newMatcher.group(3).trim();
            if (oldValue.equals(newValue)) {
                continue;
            }

            Map<String, String> row = new LinkedHashMap<>();
            int lineNumber = lineNumberForIndex(updated, newMatcher.start(3));
            row.put("filePath", filePath);
            row.put("line", String.valueOf(lineNumber));
            row.put("field", "VERSION_TAG");
            row.put("currentValue", oldValue);
            row.put("newValue", newValue);
            row.put("findingId", buildFindingId(filePath, lineNumber, "VERSION_TAG", oldValue));
            findings.add(row);
        }

        return findings;
    }

    private String updateDockerTagValue(String currentValue, String targetSnapshotVersion) {
        Matcher snapshotMatcher = SNAPSHOT_VERSION_IN_TAG_PATTERN.matcher(currentValue);
        if (snapshotMatcher.find()) {
            String currentSnapshotVersion = snapshotMatcher.group();
            String replacement = determineSnapshotReplacement(currentSnapshotVersion, targetSnapshotVersion);
            return snapshotMatcher.replaceFirst(Matcher.quoteReplacement(replacement));
        }

        Matcher genericMatcher = GENERIC_VERSION_IN_TAG_PATTERN.matcher(currentValue);
        if (genericMatcher.find()) {
            return genericMatcher.replaceFirst(Matcher.quoteReplacement(targetSnapshotVersion));
        }

        return currentValue;
    }

    private String determineSnapshotReplacement(String currentSnapshotValue, String targetSnapshotVersion) {
        String targetBaseVersion = extractBaseVersion(targetSnapshotVersion);
        String currentBaseVersion = extractBaseVersion(currentSnapshotValue);
        if (targetBaseVersion == null || currentBaseVersion == null) {
            return targetSnapshotVersion;
        }

        // If current snapshot is already on the target version family, keep it at target.
        if (targetBaseVersion.equals(currentBaseVersion)) {
            return targetSnapshotVersion;
        }

        String expectedCurrentVersion = decrementMinorVersion(targetBaseVersion);
        if (expectedCurrentVersion != null && expectedCurrentVersion.equals(currentBaseVersion)) {
            return targetSnapshotVersion;
        }

        String bumpedVersion = incrementMinorVersion(currentBaseVersion);
        if (bumpedVersion == null) {
            return targetSnapshotVersion;
        }

        return currentSnapshotValue.replaceFirst(Pattern.quote(currentBaseVersion), Matcher.quoteReplacement(bumpedVersion));
    }

    private String extractBaseVersion(String value) {
        Matcher matcher = BASE_VERSION_PATTERN.matcher(value);
        if (!matcher.find()) {
            return null;
        }
        return matcher.group();
    }

    private String decrementMinorVersion(String version) {
        String[] parts = version.split("\\.");
        if (parts.length < 2) {
            return null;
        }

        int minor;
        try {
            minor = Integer.parseInt(parts[1]);
        } catch (NumberFormatException e) {
            return null;
        }

        if (minor <= 0) {
            return null;
        }

        parts[1] = String.valueOf(minor - 1);
        for (int i = 2; i < parts.length; i++) {
            parts[i] = "0";
        }

        return String.join(".", parts);
    }

    private String incrementMinorVersion(String version) {
        String[] parts = version.split("\\.");
        if (parts.length < 2) {
            return null;
        }

        int minor;
        try {
            minor = Integer.parseInt(parts[1]);
        } catch (NumberFormatException e) {
            return null;
        }

        parts[1] = String.valueOf(minor + 1);
        for (int i = 2; i < parts.length; i++) {
            parts[i] = "0";
        }

        return String.join(".", parts);
    }

    private String applySelectedFindings(
            String originalContent,
            String fullyUpdatedContent,
            List<Map<String, String>> findings,
            Set<String> selectedFindingIds) {
        if (fullyUpdatedContent.equals(originalContent) || findings.isEmpty()) {
            return originalContent;
        }

        if (selectedFindingIds == null || selectedFindingIds.isEmpty()) {
            return fullyUpdatedContent;
        }

        List<String> sourceLines = toLines(originalContent);
        List<String> updatedLines = toLines(fullyUpdatedContent);

        boolean changed = false;
        for (Map<String, String> finding : findings) {
            String findingId = finding.getOrDefault("findingId", "");
            if (!selectedFindingIds.contains(findingId)) {
                continue;
            }

            int lineNumber = parseLineNumber(finding.get("line"));
            int index = lineNumber - 1;
            if (index < 0 || index >= sourceLines.size() || index >= updatedLines.size()) {
                continue;
            }

            if (!sourceLines.get(index).equals(updatedLines.get(index))) {
                sourceLines.set(index, updatedLines.get(index));
                changed = true;
            }
        }

        if (!changed) {
            return originalContent;
        }

        String joined = String.join("\n", sourceLines);
        if (originalContent.endsWith("\n") && !joined.endsWith("\n")) {
            joined = joined + "\n";
        }
        return joined;
    }

    private List<String> toLines(String content) {
        String[] split = content.split("\\n", -1);
        return new ArrayList<>(Arrays.asList(split));
    }

    private int parseLineNumber(String lineValue) {
        try {
            return Integer.parseInt(lineValue);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private Set<String> parseSelectedFindingIds(String csvValue) {
        Set<String> ids = new HashSet<>();
        String normalized = blankToNull(csvValue);
        if (normalized == null) {
            return ids;
        }

        for (String rawPart : normalized.split(",")) {
            String part = blankToNull(rawPart);
            if (part != null) {
                ids.add(part);
            }
        }

        return ids;
    }

    private String buildFindingId(String filePath, int line, String field, String currentValue) {
        String normalizedPath = filePath == null ? "" : filePath;
        String normalizedField = field == null ? "" : field;
        String normalizedCurrentValue = currentValue == null ? "" : currentValue.replace(",", " ");
        return normalizedPath + "|" + line + "|" + normalizedField + "|" + normalizedCurrentValue;
    }

    private JsonNode updateTextFile(String owner, String repo, String path, String sha, String branch, String content, String commitMessage) {
        String encodedContent = Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8));
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("message", commitMessage);
        payload.put("content", encodedContent);
        payload.put("sha", sha);
        payload.put("branch", branch);

        JsonNode response = restClient.put()
                .uri("https://api.github.com/repos/{owner}/{repo}/contents/" + path, owner, repo)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
            .body(payload)
                .retrieve()
                .body(JsonNode.class);

        if (response == null || response.path("commit").isMissingNode()) {
            throw new ResponseStatusException(NOT_FOUND, "Failed to commit updated file " + path);
        }
        return response;
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

    private Map<String, String> createBranch(String repoFullName, String sourceBranch, String branchName) {
        String[] ownerRepo = parseOwnerRepo(repoFullName);
        String owner = ownerRepo[0];
        String repo = ownerRepo[1];
        String sanitizedSourceBranch = normalizeBranch(sourceBranch, "master");
        String sanitizedBranchName = requireValue(branchName, "branchName");

        GitRef sourceRef = fetchBranchRef(owner, repo, sanitizedSourceBranch);

        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("ref", "refs/heads/" + sanitizedBranchName);
        payload.put("sha", sourceRef.sha());

        restClient.post()
                .uri("https://api.github.com/repos/{owner}/{repo}/git/refs", owner, repo)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
            .body(payload)
                .retrieve()
                .body(JsonNode.class);

        Map<String, String> result = new LinkedHashMap<>();
        result.put("branchName", sanitizedBranchName);
        result.put("sourceBranch", sourceRef.branch());
        result.put("created", "true");
        result.put("sha", sourceRef.sha());
        return result;
    }

    private GitRef fetchBranchRef(String owner, String repo, String branch) {
        JsonNode refNode = restClient.get()
                .uri("https://api.github.com/repos/{owner}/{repo}/git/ref/heads/{branch}", owner, repo, branch)
                .header("Authorization", "Bearer " + getToken())
                .header("Accept", "application/vnd.github+json")
                .retrieve()
                .body(JsonNode.class);

        if (refNode == null || refNode.path("object").path("sha").isMissingNode()) {
            throw new ResponseStatusException(NOT_FOUND, "Could not find source branch ref for " + branch);
        }

        return new GitRef(branch, refNode.path("object").path("sha").asText());
    }

    private String buildDefaultBranchName(String repoFullName, String jiraTicket, String targetSnapshotVersion) {
        String repo = repoFullName.contains("/") ? repoFullName.substring(repoFullName.indexOf('/') + 1) : repoFullName;
        String jiraPart = jiraTicket == null ? "upgrade" : jiraTicket.toLowerCase(Locale.ROOT);
        String sanitizedVersion = targetSnapshotVersion
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9._-]+", "-")
                .replaceAll("-+", "-");
        return "feature/" + jiraPart + "/" + repo + "-snap-" + sanitizedVersion + "-"
                + LocalDateTime.now().format(DateTimeFormatter.ofPattern("HHmmss"));
    }

    private String buildSnapshotCommitMessage(String jiraTicket, String targetSnapshotVersion, String path) {
        StringBuilder message = new StringBuilder();
        if (jiraTicket != null) {
            message.append(jiraTicket).append(": ");
        }
        message.append("Update snapshot to ").append(targetSnapshotVersion);
        message.append(" (").append(path).append(")");
        return message.toString();
    }

    private String buildSnapshotDockerCommitMessage(String jiraTicket, String targetSnapshotVersion) {
        StringBuilder message = new StringBuilder();
        if (jiraTicket != null) {
            message.append(jiraTicket).append(": ");
        }
        message.append("Update Docker workflow snapshot tag to ").append(targetSnapshotVersion);
        return message.toString();
    }

    private String buildSnapshotPrTitle(String repo, String jiraTicket, String targetSnapshotVersion) {
        StringBuilder title = new StringBuilder();
        if (jiraTicket != null) {
            title.append(jiraTicket).append(": ");
        }
        title.append("Snapshot upgrade ").append(repo).append(" to ").append(targetSnapshotVersion);
        return title.toString();
    }

    private String buildSnapshotPrBody(
            String sourceBranch,
            String workingBranch,
            String targetSnapshotVersion,
            int pomFilesUpdated,
            String dockerWorkflowPath) {
        StringBuilder body = new StringBuilder();
        body.append("Automated snapshot upgrade proposal\n\n");
        body.append("Source branch: ").append(sourceBranch).append("\n");
        body.append("Working branch: ").append(workingBranch).append("\n");
        body.append("Target snapshot version: ").append(targetSnapshotVersion).append("\n\n");
        body.append("Changes\n");
        body.append("- Updated pom.xml files: ").append(pomFilesUpdated).append("\n");
        if (dockerWorkflowPath != null && !dockerWorkflowPath.isBlank()) {
            body.append("- Updated workflow: ").append(dockerWorkflowPath).append("\n");
        }
        return body.toString();
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

    private String replaceKeepingEdgeWhitespace(String original, String replacement) {
        String trimmed = original.trim();
        if (trimmed.isEmpty()) {
            return replacement;
        }

        int leading = original.indexOf(trimmed);
        int trailingStart = leading + trimmed.length();
        return original.substring(0, leading) + replacement + original.substring(trailingStart);
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

    private boolean parseBoolean(String value, boolean fallback) {
        String normalized = blankToNull(value);
        if (normalized == null) {
            return fallback;
        }
        return Boolean.parseBoolean(normalized);
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
