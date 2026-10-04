package kz.company.shop.settings.controller;

import jakarta.validation.Valid;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.settings.dto.ProjectSettingsDto;
import kz.company.shop.settings.dto.ProjectSettingsUpdateRequest;
import kz.company.shop.settings.service.ProjectSettingsService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/settings")
@PreAuthorize("hasAuthority('pages.settings.view')")
public class ProjectSettingsController {
    private final ProjectSettingsService service;
    private final AuthContext auth;

    public ProjectSettingsController(ProjectSettingsService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<ProjectSettingsDto> get() {
        auth.require("pages.settings.view");
        return ApiResponse.ok(service.get());
    }

    @PutMapping
    public ApiResponse<ProjectSettingsDto> update(
            @RequestBody @Valid ProjectSettingsUpdateRequest request) {
        auth.require("pages.settings.view");
        return ApiResponse.ok(service.update(request));
    }
}
