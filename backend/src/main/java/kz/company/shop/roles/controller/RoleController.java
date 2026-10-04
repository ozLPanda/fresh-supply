package kz.company.shop.roles.controller;

import jakarta.validation.Valid;
import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.roles.dto.RoleDto;
import kz.company.shop.roles.service.RoleService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/roles")
public class RoleController {
    private final RoleService roleService;
    private final AuthContext auth;

    public RoleController(RoleService roleService, AuthContext auth) {
        this.roleService = roleService;
        this.auth = auth;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('roles.read')")
    public ApiResponse<List<RoleDto>> list() {
        auth.require("roles.read");
        return ApiResponse.ok(roleService.list());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('roles.create')")
    public ApiResponse<RoleDto> create(@RequestBody @Valid RoleDto dto) {
        auth.require("roles.create");
        return ApiResponse.ok(roleService.create(dto, auth.current().id()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('roles.update')")
    public ApiResponse<RoleDto> update(@PathVariable Long id, @RequestBody @Valid RoleDto dto) {
        auth.require("roles.update");
        return ApiResponse.ok(roleService.update(id, dto, auth.current().id()));
    }
}
