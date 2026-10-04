package kz.company.shop.integrations.onec.controller;

import jakarta.validation.Valid;
import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.integrations.onec.dto.OneCApiCredentialDto;
import kz.company.shop.integrations.onec.dto.OneCApiCredentialRequest;
import kz.company.shop.integrations.onec.service.OneCApiCredentialService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/integrations/1c/credentials")
@PreAuthorize("hasAuthority('integrations.1c.credentials.manage')")
public class OneCApiCredentialController {
    private static final String ACCESS_PERMISSION = "integrations.1c.credentials.manage";

    private final OneCApiCredentialService credentials;
    private final AuthContext auth;

    public OneCApiCredentialController(OneCApiCredentialService credentials, AuthContext auth) {
        this.credentials = credentials;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<List<OneCApiCredentialDto>> list() {
        auth.require(ACCESS_PERMISSION);
        return ApiResponse.ok(credentials.list());
    }

    @PostMapping
    public ApiResponse<OneCApiCredentialDto> create(
            @RequestBody @Valid OneCApiCredentialRequest request) {
        auth.require(ACCESS_PERMISSION);
        return ApiResponse.ok(credentials.create(request));
    }

    @PutMapping("/{id}")
    public ApiResponse<OneCApiCredentialDto> update(
            @PathVariable Long id, @RequestBody @Valid OneCApiCredentialRequest request) {
        auth.require(ACCESS_PERMISSION);
        return ApiResponse.ok(credentials.update(id, request));
    }

    @PostMapping("/{id}/revoke")
    public ApiResponse<OneCApiCredentialDto> revoke(@PathVariable Long id) {
        auth.require(ACCESS_PERMISSION);
        return ApiResponse.ok(credentials.revoke(id));
    }
}
