package kz.company.shop.priceImports.controller;

import java.util.UUID;
import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.priceImports.dto.PriceImportCommitDto;
import kz.company.shop.priceImports.dto.PriceImportCommitRequest;
import kz.company.shop.priceImports.dto.PriceImportPreviewDto;
import kz.company.shop.priceImports.entity.ImportPriceType;
import kz.company.shop.priceImports.service.PriceImportService;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/admin/product-price-imports")
@PreAuthorize("hasAuthority('products.update')")
public class PriceImportController {
    private final PriceImportService service;
    private final AuthContext auth;

    public PriceImportController(PriceImportService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<PriceImportPreviewDto> analyze(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "createMissingProducts", defaultValue = "false")
                    boolean createMissingProducts,
            @RequestParam(value = "updateAvailabilityAndMadeToOrder", defaultValue = "true")
                    boolean updateAvailabilityAndMadeToOrder,
            @RequestParam(value = "oneCPriceTier", required = false)
                    ImportPriceType oneCPriceTier) {
        auth.require("products.update");
        return ApiResponse.ok(
                service.analyze(
                        file,
                        auth.current(),
                        createMissingProducts,
                        updateAvailabilityAndMadeToOrder,
                        oneCPriceTier));
    }

    @PostMapping(value = "/analyze-batch", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ApiResponse<PriceImportPreviewDto> analyzeBatch(
            @RequestParam("files") List<MultipartFile> files,
            @RequestParam(value = "createMissingProducts", defaultValue = "true")
                    boolean createMissingProducts,
            @RequestParam(value = "updateAvailabilityAndMadeToOrder", defaultValue = "true")
                    boolean updateAvailabilityAndMadeToOrder) {
        auth.require("products.update");
        return ApiResponse.ok(
                service.analyzeBatch(
                        files, auth.current(), createMissingProducts, updateAvailabilityAndMadeToOrder));
    }

    @GetMapping("/{id}")
    public ApiResponse<PriceImportPreviewDto> get(@PathVariable UUID id) {
        auth.require("products.update");
        return ApiResponse.ok(service.get(id));
    }

    @PostMapping("/{id}/commit")
    public ApiResponse<PriceImportCommitDto> commit(
            @PathVariable UUID id, @RequestBody(required = false) PriceImportCommitRequest request) {
        auth.require("products.update");
        return ApiResponse.ok(service.commit(id, request == null ? null : request.selectedRowIndexes()));
    }
}
