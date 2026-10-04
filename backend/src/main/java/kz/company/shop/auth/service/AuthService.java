package kz.company.shop.auth.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import kz.company.shop.auth.dto.LoginRequest;
import kz.company.shop.auth.dto.LoginResponse;
import kz.company.shop.auth.dto.RegisterRequest;
import kz.company.shop.auth.entity.AuthSession;
import kz.company.shop.auth.repository.AuthSessionRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.users.dto.ProfileUpdateRequest;
import kz.company.shop.users.dto.OrderSettingsDto;
import kz.company.shop.users.dto.OrderSettingsUpdateRequest;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.service.UserService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final UserService userService;
    private final AuthSessionRepository sessionRepository;
    private final SecureRandom secureRandom = new SecureRandom();

    public AuthService(UserService userService, AuthSessionRepository sessionRepository) {
        this.userService = userService;
        this.sessionRepository = sessionRepository;
    }

    @Transactional
    public LoginResponse login(LoginRequest request) {
        User user = userService.byPhone(request.phone());
        if (!userService.passwordMatches(user, request.password())) {
            throw new AppExceptions.BadRequest("Неверный номер телефона или пароль");
        }
        return response(user);
    }

    @Transactional
    public LoginResponse register(RegisterRequest request) {
        return response(
                userService.register(
                        request.name(), request.email(), request.phone(), request.password()));
    }

    public Optional<CurrentUser> resolve(String token) {
        try {
            return sessionRepository
                    .findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(hash(token), Instant.now())
                    .map(session -> userService.currentUser(session.userId));
        } catch (RuntimeException ignored) {
            return Optional.empty();
        }
    }

    @Transactional
    public void logout(String token) {
        if (token == null || token.isBlank()) return;
        sessionRepository
                .findByTokenHashAndRevokedAtIsNull(hash(token))
                .ifPresent(
                        session -> {
                            session.revokedAt = Instant.now();
                            sessionRepository.save(session);
                        });
    }

    public CurrentUser updateProfile(Long userId, ProfileUpdateRequest request) {
        return userService.updateProfile(userId, request);
    }

    public OrderSettingsDto orderSettings(Long userId) { return userService.orderSettings(userId); }
    public OrderSettingsDto updateOrderSettings(Long userId, OrderSettingsUpdateRequest request) { return userService.updateOrderSettings(userId, request); }

    private LoginResponse response(User user) {
        return new LoginResponse(issue(user.id), userService.toDto(user));
    }

    private String issue(Long userId) {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        AuthSession session = new AuthSession();
        session.userId = userId;
        session.tokenHash = hash(token);
        session.expiresAt = Instant.now().plus(30, ChronoUnit.DAYS);
        sessionRepository.save(session);
        return token;
    }

    private String hash(String token) {
        try {
            byte[] digest =
                    MessageDigest.getInstance("SHA-256")
                            .digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
