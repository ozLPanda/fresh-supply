package kz.company.shop.common.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import kz.company.shop.auth.service.AuthService;
import kz.company.shop.common.response.ApiResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Component
class AuthFilter extends OncePerRequestFilter {
    private final AuthService authService;
    private final AuthContext authContext;
    private final SessionCookieService sessionCookieService;
    private final ObjectMapper objectMapper;
    private final Set<String> allowedOrigins;

    AuthFilter(
            AuthService authService,
            AuthContext authContext,
            SessionCookieService sessionCookieService,
            ObjectMapper objectMapper,
            @Value("${app.cors.allowed-origins}") String[] allowedOrigins) {
        this.authService = authService;
        this.authContext = authContext;
        this.sessionCookieService = sessionCookieService;
        this.objectMapper = objectMapper;
        this.allowedOrigins = Set.copyOf(Arrays.asList(allowedOrigins));
    }

    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            var bearerToken = sessionCookieService.bearerToken(request);
            var cookieToken = sessionCookieService.cookieToken(request);
            String origin = request.getHeader("Origin");
            if (bearerToken.isEmpty()
                    && cookieToken.isPresent()
                    && isUnsafe(request.getMethod())
                    && (origin == null || !allowedOrigins.contains(origin))) {
                SecurityConfig.writeSecurityError(
                        response,
                        objectMapper,
                        HttpServletResponse.SC_FORBIDDEN,
                        "Untrusted request origin");
                return;
            }
            bearerToken
                    .or(() -> cookieToken)
                    .flatMap(authService::resolve)
                    .ifPresent(
                            user -> {
                                authContext.set(user);
                                var authorities =
                                        user.permissions().stream()
                                                .map(SimpleGrantedAuthority::new)
                                                .toList();
                                SecurityContextHolder.getContext()
                                        .setAuthentication(
                                                UsernamePasswordAuthenticationToken.authenticated(
                                                        user, null, authorities));
                            });
            chain.doFilter(request, response);
        } finally {
            authContext.clear();
            SecurityContextHolder.clearContext();
        }
    }

    private static boolean isUnsafe(String method) {
        return !Set.of("GET", "HEAD", "OPTIONS", "TRACE").contains(method);
    }
}

@Configuration
@EnableMethodSecurity
class SecurityConfig implements WebMvcConfigurer {
    private final String[] allowedOrigins;

    SecurityConfig(@Value("${app.cors.allowed-origins}") String[] allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            AuthFilter filter,
            AuthRateLimitFilter authRateLimitFilter,
            ApiRateLimitFilter apiRateLimitFilter,
            ObjectMapper objectMapper)
            throws Exception {
        return http.csrf(AbstractHttpConfigurer::disable)
                .cors(Customizer.withDefaults())
                .authorizeHttpRequests(
                        requests ->
                                requests.requestMatchers(
                                                HttpMethod.POST,
                                                "/api/auth/login",
                                                "/api/auth/register",
                                                "/api/auth/logout",
                                                "/api/search-queries")
                                        .permitAll()
                                        .requestMatchers(
                                                HttpMethod.GET,
                                                "/api/products",
                                                "/api/products/*",
                                                "/api/products/*/storefront",
                                                "/api/products/category-counts",
                                                "/api/categories",
                                                "/api/categories/*",
                                                "/api/categories/tree",
                                                "/api/settings/store",
                                                "/api/reviews/latest",
                                                "/api/reviews/summary",
                                                "/api/products/*/reviews",
                                                "/api/products/*/reviews/summary",
                                                "/api/products/*/price-history")
                                        .permitAll()
                                        .requestMatchers(
                                                HttpMethod.GET, "/api/integrations/1c/orders/**")
                                        .permitAll()
                                        .requestMatchers(HttpMethod.POST, "/api/products/*/views")
                                        .permitAll()
                                        .requestMatchers(HttpMethod.GET, "/api/whatsapp/webhook")
                                        .permitAll()
                                        .requestMatchers(HttpMethod.POST, "/api/whatsapp/webhook")
                                        .permitAll()
                                        .requestMatchers("/actuator/health", "/actuator/health/**")
                                        .permitAll()
                                        .requestMatchers("/api/**", "/actuator/**")
                                        .authenticated()
                                        .anyRequest()
                                        .permitAll())
                .exceptionHandling(
                        exceptions ->
                                exceptions
                                        .authenticationEntryPoint(
                                                (request, response, exception) ->
                                                        writeSecurityError(
                                                                response,
                                                                objectMapper,
                                                                HttpServletResponse.SC_UNAUTHORIZED,
                                                                "Authentication required"))
                                        .accessDeniedHandler(
                                                (request, response, exception) ->
                                                        writeSecurityError(
                                                                response,
                                                                objectMapper,
                                                                HttpServletResponse.SC_FORBIDDEN,
                                                                "Access denied")))
                .addFilterBefore(filter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(authRateLimitFilter, AuthFilter.class)
                .addFilterAfter(apiRateLimitFilter, AuthRateLimitFilter.class)
                .build();
    }

    @Bean
    AuthRateLimitFilter authRateLimitFilter(RateLimiter rateLimiter, ObjectMapper objectMapper) {
        return new AuthRateLimitFilter(rateLimiter, objectMapper);
    }

    @Bean
    ApiRateLimitFilter apiRateLimitFilter(RateLimiter rateLimiter, ObjectMapper objectMapper) {
        return new ApiRateLimitFilter(rateLimiter, objectMapper);
    }

    static void writeSecurityError(
            HttpServletResponse response, ObjectMapper objectMapper, int status, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), ApiResponse.error(message, Map.of()));
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }
}
