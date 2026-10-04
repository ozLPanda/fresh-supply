package kz.company.shop.settings.controller;

import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.settings.dto.StoreSettingsDto;
import kz.company.shop.settings.service.ProjectSettingsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/settings")
public class StoreSettingsController {
    private final ProjectSettingsService service;

    public StoreSettingsController(ProjectSettingsService service) {
        this.service = service;
    }

    @GetMapping("/store")
    public ApiResponse<StoreSettingsDto> getStoreSettings() {
        return ApiResponse.ok(new StoreSettingsDto(service.wholesaleMinQuantity()));
    }
}
