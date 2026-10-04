package kz.company.shop.auth.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import kz.company.shop.auth.dto.LoginRequest;
import kz.company.shop.auth.dto.LoginResponse;
import kz.company.shop.auth.dto.RegisterRequest;
import kz.company.shop.auth.service.AuthService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.common.security.SessionCookieService;
import kz.company.shop.users.dto.ProfileUpdateRequest;
import kz.company.shop.users.dto.OrderSettingsDto;
import kz.company.shop.users.dto.OrderSettingsUpdateRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;
    private final AuthContext authContext;
    private final SessionCookieService sessionCookieService;

    public AuthController(
            AuthService authService,
            AuthContext authContext,
            SessionCookieService sessionCookieService) {
        this.authService = authService;
        this.authContext = authContext;
        this.sessionCookieService = sessionCookieService;
    }

    @PostMapping("/login")
    public ApiResponse<LoginResponse> login(
            @RequestBody @Valid LoginRequest request, HttpServletResponse response) {
        LoginResponse login = authService.login(request);
        sessionCookieService.add(response, login.token());
        return ApiResponse.ok(login);
    }

    @PostMapping("/register")
    public ApiResponse<LoginResponse> register(
            @RequestBody @Valid RegisterRequest request, HttpServletResponse response) {
        LoginResponse login = authService.register(request);
        sessionCookieService.add(response, login.token());
        return ApiResponse.ok(login);
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        sessionCookieService.token(request).ifPresent(authService::logout);
        sessionCookieService.clear(response);
        return ApiResponse.message("Выход выполнен");
    }

    @GetMapping("/me")
    public ApiResponse<CurrentUser> me() {
        return ApiResponse.ok(authContext.current());
    }

    @PutMapping("/profile")
    public ApiResponse<CurrentUser> updateProfile(
            @RequestBody @Valid ProfileUpdateRequest request) {
        return ApiResponse.ok(authService.updateProfile(authContext.current().id(), request));
    }

    @GetMapping("/order-settings")
    public ApiResponse<OrderSettingsDto> orderSettings() {
        requireAdminAccess();
        return ApiResponse.ok(authService.orderSettings(authContext.current().id()));
    }

    @PutMapping("/order-settings")
    public ApiResponse<OrderSettingsDto> updateOrderSettings(
            @RequestBody @Valid OrderSettingsUpdateRequest request) {
        requireAdminAccess();
        return ApiResponse.ok(authService.updateOrderSettings(authContext.current().id(), request));
    }

    private void requireAdminAccess() {
        CurrentUser user = authContext.current();
        if (!user.adminAccess()) {
            throw new AppExceptions.Forbidden("админ-панель");
        }
    }
}
