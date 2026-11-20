package com.marathas.utility.backend.filter;

import com.marathas.utility.backend.controller.AuthController;
import com.marathas.utility.backend.service.GithubPatContext;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class AuthFilter implements Filter {

    private static final String[] PUBLIC_PATHS = {"/api/auth/login", "/api/auth/logout", "/health"};

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        String path = httpRequest.getRequestURI();

        if (isPublicPath(path)) {
            GithubPatContext.clear();
            try {
                chain.doFilter(request, response);
            } finally {
                GithubPatContext.clear();
            }
            return;
        }

        String authenticatedUser = (String) httpRequest.getSession()
                .getAttribute(AuthController.AUTHENTICATED_USER_KEY);

        if (authenticatedUser == null) {
            GithubPatContext.clear();
            httpResponse.setStatus(401);
            httpResponse.setContentType("application/json");
            httpResponse.getWriter().write("{\"error\":\"Unauthorized\"}");
            return;
        }

        String sessionPat = (String) httpRequest.getSession(false).getAttribute("github_pat_token");
        String headerPat = httpRequest.getHeader("X-GitHub-PAT");
        GithubPatContext.set(headerPat != null && !headerPat.isBlank() ? headerPat : sessionPat);

        try {
            chain.doFilter(request, response);
        } finally {
            GithubPatContext.clear();
        }
    }

    private boolean isPublicPath(String path) {
        for (String publicPath : PUBLIC_PATHS) {
            if (path.equals(publicPath) || path.startsWith(publicPath)) {
                return true;
            }
        }
        return false;
    }
}