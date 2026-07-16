package com.marathas.utility.backend.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.marathas.utility.backend.service.JenkinsService;

@RestController
@RequestMapping("/api/jenkins")
public class JenkinsController {

    private final JenkinsService jenkinsService;

    public JenkinsController(JenkinsService jenkinsService) {
        this.jenkinsService = jenkinsService;
    }

    @GetMapping("/config")
    public Map<String, String> getConfig() {
        return jenkinsService.fetchConfig();
    }

    @GetMapping("/jobs")
    public List<Map<String, String>> getJobs(
            @RequestParam(required = false) String jobPath,
            @RequestParam(defaultValue = "true") boolean recursive) {
        return jenkinsService.fetchJobs(jobPath, recursive);
    }

    @GetMapping("/builds")
    public List<Map<String, String>> getBuilds(
            @RequestParam(required = false) String jobPath,
            @RequestParam(required = false) Integer limit) {
        return jenkinsService.fetchBuilds(jobPath, limit);
    }

    @PostMapping("/deploy")
    public Map<String, String> triggerDeploy(@RequestBody(required = false) Map<String, Object> request) {
        return jenkinsService.triggerDeploy(request);
    }
}
