package com.marathas.utility.backend;

import com.marathas.utility.backend.config.GithubOAuthProperties;
import com.marathas.utility.backend.config.LdapProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties({GithubOAuthProperties.class, LdapProperties.class})
public class MarathasUtilityBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(MarathasUtilityBackendApplication.class, args);
    }
}
