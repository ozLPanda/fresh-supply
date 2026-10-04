package kz.company.shop.productImages.controller;

import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.productImages.service.ProductImageService;
import kz.company.shop.products.dto.ProductImageDto;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/products/{productId}/images")
public class ProductImageController {
    private final ProductImageService productImageService;
    private final AuthContext auth;

    public ProductImageController(ProductImageService productImageService, AuthContext auth) {
        this.productImageService = productImageService;
        this.auth = auth;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<ProductImageDto> upload(
            @PathVariable Long productId, @RequestParam("file") MultipartFile file) {
        auth.require("products.update");
        return ApiResponse.ok(productImageService.upload(productId, file));
    }

    @DeleteMapping("/{imageId}")
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<List<ProductImageDto>> delete(
            @PathVariable Long productId, @PathVariable Long imageId) {
        auth.require("products.update");
        return ApiResponse.ok(productImageService.delete(productId, imageId));
    }

    @PatchMapping("/{imageId}/main")
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<List<ProductImageDto>> setMain(
            @PathVariable Long productId, @PathVariable Long imageId) {
        auth.require("products.update");
        return ApiResponse.ok(productImageService.setMain(productId, imageId));
    }
}
