package kz.company.shop.users.controller;

import jakarta.validation.Valid;
import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.users.dto.UserCreateRequest;
import kz.company.shop.users.dto.UserDto;
import kz.company.shop.users.dto.UserPasswordUpdateRequest;
import kz.company.shop.users.dto.UserRolesUpdateRequest;
import kz.company.shop.users.dto.UserUpdateRequest;
import kz.company.shop.users.service.UserService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;
    private final AuthContext auth;

    public UserController(UserService userService, AuthContext auth) {
        this.userService = userService;
        this.auth = auth;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('users.read')")
    public ApiResponse<List<UserDto>> list(@RequestParam(required = false) String permission) {
        auth.require("users.read");
        if (permission == null || permission.isBlank()) return ApiResponse.ok(userService.list());
        return ApiResponse.ok(userService.listActiveWithPermission(permission.trim()));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('users.read')")
    public ApiResponse<UserDto> get(@PathVariable Long id) {
        auth.require("users.read");
        return ApiResponse.ok(userService.toDto(userService.byId(id)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('users.create')")
    public ApiResponse<UserDto> create(@RequestBody @Valid UserCreateRequest request) {
        auth.require("users.create");
        return ApiResponse.ok(userService.create(request, auth.current().id()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('users.update')")
    public ApiResponse<UserDto> update(
            @PathVariable Long id, @RequestBody @Valid UserUpdateRequest request) {
        auth.require("users.update");
        return ApiResponse.ok(userService.update(id, request));
    }

    @PatchMapping("/{id}/password")
    @PreAuthorize("hasAuthority('users.update')")
    public ApiResponse<UserDto> updatePassword(
            @PathVariable Long id, @RequestBody @Valid UserPasswordUpdateRequest request) {
        auth.require("users.update");
        return ApiResponse.ok(userService.updatePassword(id, request));
    }

    @PutMapping("/{id}/roles")
    @PreAuthorize("hasAuthority('users.update')")
    public ApiResponse<UserDto> updateRoles(
            @PathVariable Long id, @RequestBody UserRolesUpdateRequest request) {
        auth.require("users.update");
        return ApiResponse.ok(userService.updateRoles(id, request, auth.current().id()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('users.delete')")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        auth.require("users.delete");
        userService.delete(id);
        return ApiResponse.message("Пользователь удален");
    }
}
