package kz.company.shop.common.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.Arrays;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

@Component
public class SessionCookieService {
    private final String name;
    private final String path;
    private final boolean secure;
    private final String sameSite;
    private final Duration maxAge;

    public SessionCookieService(
            @Value("${app.auth.cookie.name}") String name,
            @Value("${app.auth.cookie.path}") String path,
            @Value("${app.auth.cookie.secure}") boolean secure,
            @Value("${app.auth.cookie.same-site}") String sameSite,
            @Value("${app.auth.cookie.max-age-seconds}") long maxAgeSeconds) {
        this.name = name;
        this.path = path;
        this.secure = secure;
        this.sameSite = sameSite;
        this.maxAge = Duration.ofSeconds(maxAgeSeconds);
    }

    public Optional<String> bearerToken(HttpServletRequest request) {
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization != null && authorization.startsWith("Bearer ")) {
            String token = authorization.substring(7);
            if (!token.isBlank()) {
                return Optional.of(token);
            }
        }
        return Optional.empty();
    }

    public Optional<String> cookieToken(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }
        return Arrays.stream(cookies)
                .filter(cookie -> name.equals(cookie.getName()))
                .map(Cookie::getValue)
                .filter(value -> !value.isBlank())
                .findFirst();
    }

    public Optional<String> token(HttpServletRequest request) {
        return bearerToken(request).or(() -> cookieToken(request));
    }

    public void add(HttpServletResponse response, String token) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(token, maxAge).toString());
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
    }

    private ResponseCookie cookie(String value, Duration cookieMaxAge) {
        return ResponseCookie.from(name, value)
                .httpOnly(true)
                .secure(secure)
                .sameSite(sameSite)
                .path(path)
                .maxAge(cookieMaxAge)
                .build();
    }
}
