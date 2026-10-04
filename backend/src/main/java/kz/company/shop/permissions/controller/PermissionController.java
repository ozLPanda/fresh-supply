package kz.company.shop.permissions.controller;

import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.permissions.dto.PermissionDto;
import kz.company.shop.permissions.service.PermissionService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/permissions")
@PreAuthorize("hasAuthority('roles.read')")
public class PermissionController {
    private final PermissionService permissionService;
    private final AuthContext auth;

    public PermissionController(PermissionService permissionService, AuthContext auth) {
        this.permissionService = permissionService;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<List<PermissionDto>> list() {
        auth.require("roles.read");
        return ApiResponse.ok(permissionService.list());
    }
}
