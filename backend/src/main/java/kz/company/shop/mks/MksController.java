package kz.company.shop.mks;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import kz.company.shop.common.response.ApiResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/mks")
public class MksController {
    private final MksAccess access;
    private final MksService service;

    public MksController(MksAccess access, MksService service) {
        this.access = access;
        this.service = service;
    }

    @GetMapping("/status")
    public ApiResponse<MksDto.Status> status(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        access.requireCatalogAccess();
        return ApiResponse.ok(service.status());
    }

    @PostMapping("/connect")
    public ApiResponse<MksDto.Status> connect(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        access.requireCatalogAccess();
        return ApiResponse.ok(service.connect());
    }

    @PostMapping("/search")
    public ApiResponse<MksDto.SearchResult> search(
            @Valid @RequestBody MksDto.SearchRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        access.requireCatalogAccess();
        return ApiResponse.ok(service.search(request));
    }

    @GetMapping("/products/{id}")
    public ApiResponse<MksDto.ProductDetails> product(
            @PathVariable String id, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        access.requireCatalogAccess();
        return ApiResponse.ok(service.product(id));
    }
}
