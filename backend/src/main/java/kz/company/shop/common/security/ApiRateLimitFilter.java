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

/** Shared ceiling for dynamic backend requests, independent from the Nginx edge limit. */
final class ApiRateLimitFilter extends OncePerRequestFilter {
    private static final int LIMIT = 300;
    private static final Duration WINDOW = Duration.ofMinutes(1);

    private final RedisRateLimiter rateLimiter;
    private final ObjectMapper objectMapper;

    ApiRateLimitFilter(RedisRateLimiter rateLimiter, ObjectMapper objectMapper) {
        this.rateLimiter = rateLimiter;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return "OPTIONS".equalsIgnoreCase(request.getMethod())
                || path.startsWith("/actuator/")
                || "/api/auth/login".equals(path)
                || "/api/auth/register".equals(path);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            if (!rateLimiter.exceeded(
                    "api-rate-limit:all:" + clientAddress(request), LIMIT, WINDOW)) {
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

        writeError(response, 429, "Слишком много запросов. Повторите через минуту.", 60);
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
