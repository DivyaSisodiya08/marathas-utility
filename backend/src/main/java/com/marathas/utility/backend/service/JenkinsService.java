package com.marathas.utility.backend.service;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Queue;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import static org.springframework.http.HttpStatus.BAD_GATEWAY;
import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriComponentsBuilder;
import org.springframework.web.util.UriUtils;

import com.fasterxml.jackson.databind.JsonNode;
import com.marathas.utility.backend.config.JenkinsProperties;

@Service
public class JenkinsService {

    private static final Logger log = LoggerFactory.getLogger(JenkinsService.class);

    private final RestClient restClient;
    private final JenkinsProperties properties;

    public JenkinsService(RestClient.Builder restClientBuilder, JenkinsProperties properties) {
        this.restClient = restClientBuilder.build();
        this.properties = properties;
    }

    public Map<String, String> fetchConfig() {
        Map<String, String> result = new LinkedHashMap<>();
        result.put("baseUrl", normalizeBaseUrl());
        result.put("defaultJobPath", normalizeJobPath(properties.getDefaultJobPath(), true));
        result.put("authenticated", String.valueOf(hasCredentials()));
        return result;
    }

    public List<Map<String, String>> fetchJobs(String jobPath, boolean recursive) {
        String normalizedJobPath = normalizeJobPath(jobPath, true);
        JsonNode response = getJson(buildJobApiUrl(normalizedJobPath));
        if (response == null) {
            return new ArrayList<>();
        }

        List<Map<String, String>> directJobs = extractJobs(response);
        if (directJobs.isEmpty()) {
            JsonNode rawResponse = getJson(buildRawJobApiUrl(normalizedJobPath));
            if (rawResponse != null) {
                response = rawResponse;
                directJobs = extractJobs(rawResponse);
            }
        }
        if (directJobs.isEmpty()) {
            return buildLeafFallback(response, normalizedJobPath);
        }

        List<Map<String, String>> jobs = new ArrayList<>();
        Set<String> addedPaths = new HashSet<>();
        for (Map<String, String> row : directJobs) {
            String path = blankToNull(row.get("jobPath"));
            if (path == null || addedPaths.add(path)) {
                jobs.add(row);
            }
        }

        if (!recursive) {
            return jobs;
        }

        Queue<String> queue = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        visited.add(normalizedJobPath);

        for (Map<String, String> row : directJobs) {
            String childPath = blankToNull(row.get("jobPath"));
            if (childPath != null && visited.add(childPath)) {
                queue.add(childPath);
            }
        }

        while (!queue.isEmpty()) {
            String currentPath = queue.poll();
            JsonNode node = getJsonOrNull(buildJobApiUrl(currentPath), currentPath);
            if (node == null) {
                continue;
            }

            List<Map<String, String>> currentChildren = extractJobs(node);
            if (currentChildren.isEmpty()) {
                JsonNode rawNode = getJsonOrNull(buildRawJobApiUrl(currentPath), currentPath);
                if (rawNode != null) {
                    currentChildren = extractJobs(rawNode);
                }
            }
            for (Map<String, String> child : currentChildren) {
                String childPath = blankToNull(child.get("jobPath"));
                if (childPath == null || addedPaths.add(childPath)) {
                    jobs.add(child);
                }
                if (childPath != null && visited.add(childPath)) {
                    queue.add(childPath);
                }
            }
        }

        return jobs;
    }

    private List<Map<String, String>> extractJobs(JsonNode response) {
        List<Map<String, String>> jobs = new ArrayList<>();
        if (!response.path("jobs").isArray()) {
            return jobs;
        }

        for (JsonNode job : response.path("jobs")) {
            String url = job.path("url").asText("");
            String childPath = extractJobPath(url);
            jobs.add(buildJobRow(
                    job.path("name").asText(""),
                    url,
                    childPath == null ? "" : childPath,
                    job.path("color").asText("")));
        }

        return jobs;
    }

    private List<Map<String, String>> buildLeafFallback(JsonNode response, String normalizedJobPath) {
        List<Map<String, String>> jobs = new ArrayList<>();
        String currentJobName = response.path("name").asText("");
        if (currentJobName.isBlank()) {
            return jobs;
        }

        jobs.add(buildJobRow(
                currentJobName,
                response.path("url").asText(buildJobBaseUrl(normalizedJobPath) + "/"),
                normalizedJobPath,
                response.path("color").asText("")));
        return jobs;
    }

    private Map<String, String> buildJobRow(String name, String url, String jobPath, String color) {
        Map<String, String> item = new LinkedHashMap<>();
        item.put("name", name == null ? "" : name);
        item.put("url", url == null ? "" : url);
        item.put("jobPath", jobPath == null ? "" : jobPath);
        item.put("status", mapStatus(color));
        return item;
    }

    public List<Map<String, String>> fetchBuilds(String jobPath, Integer limit) {
        int maxRows = sanitizeLimit(limit);
        String normalizedJobPath = normalizeJobPath(jobPath, true);
        String apiUrl = buildJobApiUrl(normalizedJobPath);

        JsonNode response = getJson(apiUrl);
        if (response == null || !response.path("builds").isArray()) {
            return new ArrayList<>();
        }

        List<Map<String, String>> builds = new ArrayList<>();
        int count = 0;
        for (JsonNode build : response.path("builds")) {
            if (count >= maxRows) {
                break;
            }

            Map<String, String> row = new LinkedHashMap<>();
            row.put("number", build.path("number").asText(""));
            row.put("displayName", build.path("displayName").asText(""));
            row.put("url", build.path("url").asText(""));
            row.put("result", build.path("result").asText(""));
            row.put("building", String.valueOf(build.path("building").asBoolean(false)));
            row.put("timestamp", build.path("timestamp").asText(""));
            row.put("duration", build.path("duration").asText(""));
            builds.add(row);
            count++;
        }

        return builds;
    }

    public Map<String, String> triggerDeploy(Map<String, Object> request) {
        String jobPath = request == null ? null : valueAsString(request.get("jobPath"));
        String normalizedJobPath = normalizeJobPath(jobPath, true);
        Map<String, String> parameters = parseParameters(request == null ? null : request.get("parameters"));

        String triggerUrl;
        if (parameters.isEmpty()) {
            triggerUrl = buildJobBaseUrl(normalizedJobPath) + "/build?delay=0sec";
        } else {
            UriComponentsBuilder builder = UriComponentsBuilder
                    .fromUriString(buildJobBaseUrl(normalizedJobPath) + "/buildWithParameters")
                    .queryParam("delay", "0sec");
            for (Map.Entry<String, String> entry : parameters.entrySet()) {
                builder.queryParam(Objects.requireNonNull(entry.getKey()), Objects.requireNonNull(entry.getValue()));
            }
            triggerUrl = builder.build(true).toUriString();
        }

        String crumbUrl = normalizeBaseUrl() + "/crumbIssuer/api/json";
        Map<String, String> crumb = fetchCrumb(crumbUrl);

        restClient.post()
                .uri(triggerUrl)
                .headers(headers -> {
                    applyAuthHeaders(headers);
                    if (crumb != null) {
                        String field = crumb.get("field");
                        String value = crumb.get("value");
                        if (field != null && !field.isBlank() && value != null && !value.isBlank()) {
                            headers.set(field, value);
                        }
                    }
                })
                .retrieve()
                .toBodilessEntity();

        Map<String, String> result = new LinkedHashMap<>();
        result.put("status", "queued");
        result.put("jobPath", normalizedJobPath);
        result.put("jobUrl", buildJobBaseUrl(normalizedJobPath) + "/");
        return result;
    }

    private JsonNode getJson(String url) {
        try {
            return restClient.get()
                    .uri(Objects.requireNonNull(url))
                    .headers(this::applyAuthHeaders)
                    .retrieve()
                    .body(JsonNode.class);
        } catch (HttpStatusCodeException e) {
            if (e.getStatusCode().value() == 401 || e.getStatusCode().value() == 403) {
                throw new ResponseStatusException(
                        UNAUTHORIZED,
                        "Jenkins authentication failed. Verify JENKINS_USERNAME and JENKINS_API_TOKEN.");
            }
            throw new ResponseStatusException(
                    BAD_GATEWAY,
                    "Jenkins API request failed with status " + e.getStatusCode().value() + ".");
        } catch (Exception e) {
            throw new ResponseStatusException(
                    BAD_GATEWAY,
                    "Failed to reach Jenkins. Check JENKINS_BASE_URL, job path, and network access.");
        }
    }

    private JsonNode getJsonOrNull(String url, String jobPath) {
        try {
            return getJson(url);
        } catch (ResponseStatusException e) {
            int status = e.getStatusCode().value();
            if (status == UNAUTHORIZED.value()) {
                throw e;
            }

            if (status == BAD_GATEWAY.value()) {
                log.warn("Skipping Jenkins job path {} because Jenkins API returned an error", jobPath);
                return null;
            }

            throw e;
        }
    }

    private Map<String, String> fetchCrumb(String crumbUrl) {
        try {
            JsonNode response = restClient.get()
                    .uri(Objects.requireNonNull(crumbUrl))
                    .headers(this::applyAuthHeaders)
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null) {
                return null;
            }

            String field = response.path("crumbRequestField").asText("");
            String value = response.path("crumb").asText("");
            if (field.isBlank() || value.isBlank()) {
                return null;
            }

            Map<String, String> crumb = new LinkedHashMap<>();
            crumb.put("field", field);
            crumb.put("value", value);
            return crumb;
        } catch (Exception ignored) {
            // Some Jenkins instances have CSRF protection disabled.
            return null;
        }
    }

    private void applyAuthHeaders(org.springframework.http.HttpHeaders headers) {
        String username = blankToNull(properties.getUsername());
        String token = blankToNull(properties.getApiToken());
        if (username == null || token == null) {
            return;
        }

        String raw = username + ":" + token;
        String encoded = Base64.getEncoder().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
        headers.set("Authorization", "Basic " + encoded);
    }

    private boolean hasCredentials() {
        return blankToNull(properties.getUsername()) != null && blankToNull(properties.getApiToken()) != null;
    }

    private String buildJobApiUrl(String normalizedJobPath) {
        String tree = URLEncoder.encode(
            "name,url,color,jobs[name,url,color],builds[number,displayName,url,result,building,timestamp,duration]",
            StandardCharsets.UTF_8);
        return buildJobBaseUrl(normalizedJobPath) + "/api/json?tree=" + tree;
    }

    private String buildRawJobApiUrl(String normalizedJobPath) {
        return buildJobBaseUrl(normalizedJobPath) + "/api/json";
    }

    private String buildJobBaseUrl(String normalizedJobPath) {
        String baseUrl = normalizeBaseUrl();
        StringBuilder url = new StringBuilder(baseUrl);

        for (String segment : normalizedJobPath.split("/")) {
            String trimmed = blankToNull(segment);
            if (trimmed == null) {
                continue;
            }
            url.append("/job/").append(UriUtils.encodePathSegment(trimmed, "UTF-8"));
        }

        return url.toString();
    }

    private String normalizeBaseUrl() {
        String baseUrl = blankToNull(properties.getBaseUrl());
        if (baseUrl == null) {
            throw new ResponseStatusException(BAD_REQUEST, "jenkins.base-url is not configured");
        }
        return baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    private String normalizeJobPath(String input, boolean allowDefault) {
        String candidate = blankToNull(input);
        if (candidate == null && allowDefault) {
            candidate = blankToNull(properties.getDefaultJobPath());
        }
        if (candidate == null) {
            throw new ResponseStatusException(BAD_REQUEST, "jobPath is required");
        }

        String extracted = extractJobPath(candidate);
        if (extracted == null) {
            throw new ResponseStatusException(BAD_REQUEST, "Invalid Jenkins job path or URL");
        }

        return extracted;
    }

    private String extractJobPath(String rawInput) {
        String value = blankToNull(rawInput);
        if (value == null) {
            return null;
        }

        String path;
        if (value.startsWith("http://") || value.startsWith("https://")) {
            try {
                path = URI.create(value).getPath();
            } catch (Exception e) {
                return null;
            }
        } else {
            path = value;
        }

        String[] tokens = path.split("/");
        List<String> segments = new ArrayList<>();

        for (int i = 0; i < tokens.length; i++) {
            String token = blankToNull(tokens[i]);
            if (token == null) {
                continue;
            }

            if ("job".equalsIgnoreCase(token) && i + 1 < tokens.length) {
                String next = blankToNull(tokens[++i]);
                if (next != null) {
                    segments.add(URLDecoder.decode(next, StandardCharsets.UTF_8));
                }
                continue;
            }

            if (!path.contains("/job/")) {
                segments.add(URLDecoder.decode(token, StandardCharsets.UTF_8));
            }
        }

        if (segments.isEmpty()) {
            return null;
        }

        return String.join("/", segments);
    }

    private int sanitizeLimit(Integer limit) {
        if (limit == null) {
            return 20;
        }
        if (limit < 1) {
            return 1;
        }
        if (limit > 100) {
            return 100;
        }
        return limit;
    }

    private String mapStatus(String color) {
        String value = blankToNull(color);
        if (value == null) {
            return "unknown";
        }
        String normalized = value.toLowerCase(Locale.ROOT);
        if (normalized.startsWith("blue")) {
            return "success";
        }
        if (normalized.startsWith("red")) {
            return "failed";
        }
        if (normalized.startsWith("yellow")) {
            return "unstable";
        }
        if (normalized.startsWith("disabled")) {
            return "disabled";
        }
        if (normalized.endsWith("_anime")) {
            return "running";
        }
        return normalized;
    }

    private Map<String, String> parseParameters(Object value) {
        Map<String, String> parameters = new LinkedHashMap<>();
        if (!(value instanceof Map<?, ?> rawMap)) {
            return parameters;
        }

        for (Map.Entry<?, ?> entry : rawMap.entrySet()) {
            String key = blankToNull(valueAsString(entry.getKey()));
            String paramValue = valueAsString(entry.getValue());
            if (key != null && paramValue != null) {
                parameters.put(key, paramValue);
            }
        }

        return parameters;
    }

    private String valueAsString(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }

    private String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
