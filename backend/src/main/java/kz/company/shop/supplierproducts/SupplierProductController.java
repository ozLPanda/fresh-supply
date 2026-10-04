package kz.company.shop.supplierproducts;

import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/supplier-products")
public class SupplierProductController {
    private final SupplierProductAccess access;
    private final SupplierProductService service;

    public SupplierProductController(SupplierProductAccess access, SupplierProductService service) {
        this.access = access;
        this.service = service;
    }

    private void read(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        access.requireRead();
    }

    @GetMapping("/suppliers")
    public ApiResponse<List<SupplierProductDto.Supplier>> suppliers(HttpServletResponse response) {
        read(response);
        return ApiResponse.ok(List.of(new SupplierProductDto.Supplier("mks", "МКС")));
    }

    @GetMapping
    public ApiResponse<SupplierProductDto.ProductPage> products(
            @RequestParam(required = false) String supplier,
            @RequestParam(required = false) String query,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(defaultValue = "name") String sort,
            @RequestParam(defaultValue = "asc") String direction,
            HttpServletResponse response) {
        read(response);
        return ApiResponse.ok(service.products(supplier, query, page, size, sort, direction));
    }

    @GetMapping("/{id}")
    public ApiResponse<SupplierProductDto.Product> product(
            @PathVariable long id, HttpServletResponse response) {
        read(response);
        return ApiResponse.ok(service.product(id));
    }

    @GetMapping("/imports")
    public ApiResponse<List<SupplierProductDto.ImportJob>> imports(HttpServletResponse response) {
        read(response);
        return ApiResponse.ok(service.imports());
    }

    @PostMapping("/imports")
    public ApiResponse<SupplierProductDto.ImportJob> createImport(
            @RequestBody SupplierProductDto.ImportRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        access.requireImport();
        return ApiResponse.ok(service.createImport(request));
    }

    @PostMapping("/imports/{id}/retry")
    public ApiResponse<SupplierProductDto.ImportJob> retry(
            @PathVariable long id, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        access.requireImport();
        return ApiResponse.ok(service.retry(id));
    }

    @GetMapping("/sync-status")
    public ApiResponse<SupplierProductDto.SyncStatus> syncStatus(HttpServletResponse response) {
        read(response);
        return ApiResponse.ok(service.syncStatus());
    }
}
