package kz.company.shop.integrations.onec.controller;

import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.integrations.onec.dto.OneCStatusDto;
import kz.company.shop.integrations.onec.service.OneCIntegrationService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/integrations/onec")
@PreAuthorize("hasAuthority('pages.externalSoftware.view')")
public class OneCController {
    private final OneCIntegrationService oneCIntegrationService;
    private final AuthContext auth;

    public OneCController(OneCIntegrationService oneCIntegrationService, AuthContext auth) {
        this.oneCIntegrationService = oneCIntegrationService;
        this.auth = auth;
    }

    @GetMapping("/status")
    public ApiResponse<OneCStatusDto> status() {
        auth.require("pages.externalSoftware.view");
        return ApiResponse.ok(oneCIntegrationService.status());
    }
}
