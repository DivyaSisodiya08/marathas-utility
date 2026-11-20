package com.marathas.utility.backend.service;

public final class GithubPatContext {

    private static final ThreadLocal<String> CURRENT_PAT = new ThreadLocal<>();

    private GithubPatContext() {
    }

    public static void set(String pat) {
        if (pat == null || pat.isBlank()) {
            CURRENT_PAT.remove();
        } else {
            CURRENT_PAT.set(pat.trim());
        }
    }

    public static String get() {
        return CURRENT_PAT.get();
    }

    public static void clear() {
        CURRENT_PAT.remove();
    }
}
