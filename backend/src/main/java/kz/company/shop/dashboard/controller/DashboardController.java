package kz.company.shop.dashboard.controller;

import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.dashboard.dto.DashboardDto;
import kz.company.shop.dashboard.service.DashboardService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/dashboard")
@PreAuthorize("hasAuthority('pages.dashboard.view')")
public class DashboardController {
    private final DashboardService service;
    private final AuthContext auth;

    public DashboardController(DashboardService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<DashboardDto> get(@RequestParam(defaultValue = "30") int period) {
        auth.require("pages.dashboard.view");
        return ApiResponse.ok(service.get(period));
    }
}
