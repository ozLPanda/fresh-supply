package kz.company.shop.regularbuyers.controller;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.regularbuyers.dto.RegularBuyerDto;
import kz.company.shop.regularbuyers.dto.RegularBuyerRequest;
import kz.company.shop.regularbuyers.service.RegularBuyerService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/regular-buyers")
public class RegularBuyerController {
    private final RegularBuyerService service;
    private final AuthContext auth;
    public RegularBuyerController(RegularBuyerService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('regular-buyers.read', 'regular-buyers.manage', 'orders.update')")
    public ApiResponse<List<RegularBuyerDto>> list(@RequestParam(defaultValue = "false") boolean includeArchived) {
        if (!auth.current().permissions().contains("orders.update")
                && !auth.current().permissions().contains("regular-buyers.manage")) auth.require("regular-buyers.read");
        return ApiResponse.ok(service.list(includeArchived));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('regular-buyers.manage')")
    public ApiResponse<RegularBuyerDto> create(@RequestBody @Valid RegularBuyerRequest request) {
        auth.require("regular-buyers.manage");
        return ApiResponse.ok(service.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('regular-buyers.manage')")
    public ApiResponse<RegularBuyerDto> update(@PathVariable UUID id, @RequestBody @Valid RegularBuyerRequest request) {
        auth.require("regular-buyers.manage");
        return ApiResponse.ok(service.update(id, request));
    }
}
