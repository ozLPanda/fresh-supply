package kz.company.shop.priceImports.controller;

import java.util.List;
import java.util.UUID;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.priceImports.dto.ImportCreatedProductActivationAnalysisDto;
import kz.company.shop.priceImports.dto.ImportCreatedProductActivationResultDto;
import kz.company.shop.priceImports.dto.ImportCreatedProductDto;
import kz.company.shop.priceImports.dto.ImportCreatedProductImportDto;
import kz.company.shop.priceImports.service.ImportCreatedProductService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/import-created-products")
@PreAuthorize("hasAuthority('products.read')")
public class ImportCreatedProductController {
    private final ImportCreatedProductService service;
    private final AuthContext auth;

    public ImportCreatedProductController(ImportCreatedProductService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<PageResult<ImportCreatedProductDto>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) UUID importId,
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String direction) {
        auth.require("products.read");
        return ApiResponse.ok(service.list(page, size, search, importId, active, sort, direction));
    }

    @GetMapping("/imports")
    public ApiResponse<List<ImportCreatedProductImportDto>> imports() {
        auth.require("products.read");
        return ApiResponse.ok(service.imports());
    }

    @PostMapping("/drafts/activation-analysis")
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<ImportCreatedProductActivationAnalysisDto> analyzeDraftActivation() {
        auth.require("products.update");
        return ApiResponse.ok(service.analyzeDraftActivation());
    }

    @PostMapping("/drafts/activate")
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<ImportCreatedProductActivationResultDto> activateEligibleDrafts() {
        auth.require("products.update");
        return ApiResponse.ok(service.activateEligibleDrafts());
    }
}
