package com.marathas.utility.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

import com.marathas.utility.backend.config.AuthProperties;
import com.marathas.utility.backend.config.GithubOAuthProperties;

@SpringBootApplication
@EnableConfigurationProperties({GithubOAuthProperties.class, AuthProperties.class})
public class MarathasUtilityBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(MarathasUtilityBackendApplication.class, args);
    }
}
