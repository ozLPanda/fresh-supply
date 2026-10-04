package kz.company.shop.analytics.controller;

import java.time.LocalDate;
import kz.company.shop.analytics.dto.SalesAnalyticsDto;
import kz.company.shop.analytics.service.SalesAnalyticsService;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/analytics/sales")
@PreAuthorize("hasAuthority('pages.analytics.view')")
public class SalesAnalyticsController {
    private final SalesAnalyticsService service;
    private final AuthContext auth;

    public SalesAnalyticsController(SalesAnalyticsService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<SalesAnalyticsDto> get(
            @RequestParam(defaultValue = "day") String groupBy,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate to,
            @RequestParam(required = false) String dimension,
            @RequestParam(required = false) Long entityId) {
        auth.require("pages.analytics.view");
        return ApiResponse.ok(service.get(groupBy, from, to, dimension, entityId));
    }
}
