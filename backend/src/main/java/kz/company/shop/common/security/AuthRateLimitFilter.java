package kz.company.shop.common.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import kz.company.shop.common.response.ApiResponse;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Rate limit for anonymous authentication endpoints. Production instances share Redis counters; the
 * loopback desktop backend uses a bounded local counter.
 */
final class AuthRateLimitFilter extends OncePerRequestFilter {
    private static final String LOGIN_PATH = "/api/auth/login";
    private static final String REGISTER_PATH = "/api/auth/register";
    private static final int LOGIN_LIMIT = 20;
    private static final Duration LOGIN_WINDOW = Duration.ofMinutes(1);
    private static final int REGISTER_LIMIT = 5;
    private static final Duration REGISTER_WINDOW = Duration.ofHours(1);

    private final RateLimiter rateLimiter;
    private final ObjectMapper objectMapper;

    AuthRateLimitFilter(RateLimiter rateLimiter, ObjectMapper objectMapper) {
        this.rateLimiter = rateLimiter;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!"POST".equalsIgnoreCase(request.getMethod())) return true;
        String path = request.getRequestURI();
        return !LOGIN_PATH.equals(path) && !REGISTER_PATH.equals(path);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        boolean registration = REGISTER_PATH.equals(request.getRequestURI());
        int limit = registration ? REGISTER_LIMIT : LOGIN_LIMIT;
        Duration window = registration ? REGISTER_WINDOW : LOGIN_WINDOW;
        String operation = registration ? "register" : "login";

        try {
            if (!rateLimiter.exceeded(
                    "auth-rate-limit:" + operation + ":" + clientAddress(request), limit, window)) {
                chain.doFilter(request, response);
                return;
            }
        } catch (DataAccessException exception) {
            writeError(
                    response,
                    HttpServletResponse.SC_SERVICE_UNAVAILABLE,
                    "Защита временно недоступна",
                    60);
            return;
        }

        writeError(
                response,
                429,
                registration
                        ? "Слишком много попыток регистрации. Повторите через час."
                        : "Слишком много попыток входа. Повторите через минуту.",
                Math.max(1, window.toSeconds()));
    }

    private static String clientAddress(HttpServletRequest request) {
        String forwardedAddress = request.getHeader("X-Real-IP");
        if (forwardedAddress != null && forwardedAddress.matches("[0-9A-Fa-f:.]{1,64}")) {
            return forwardedAddress;
        }
        return request.getRemoteAddr();
    }

    private void writeError(
            HttpServletResponse response, int status, String message, long retryAfter)
            throws IOException {
        response.setStatus(status);
        response.setHeader("Retry-After", Long.toString(retryAfter));
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(
                response.getOutputStream(), ApiResponse.error(message, java.util.Map.of()));
    }
}
