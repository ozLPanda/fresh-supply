package kz.company.shop.barcodes.controller;

import jakarta.validation.Valid;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import kz.company.shop.barcodes.dto.BarcodePdfRequest;
import kz.company.shop.barcodes.dto.BarcodeProductNamesRequest;
import kz.company.shop.barcodes.service.BarcodePdfService;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.products.dto.ProductSkuLookupDto;
import kz.company.shop.products.service.ProductService;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/barcodes")
@PreAuthorize("hasAuthority('products.read')")
public class BarcodeController {
    private static final DateTimeFormatter FILE_TIMESTAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private final BarcodePdfService service;
    private final ProductService productService;
    private final AuthContext auth;

    public BarcodeController(
            BarcodePdfService service, ProductService productService, AuthContext auth) {
        this.service = service;
        this.productService = productService;
        this.auth = auth;
    }

    @PostMapping("/product-names")
    public ApiResponse<Map<String, ProductSkuLookupDto>> findProductNames(
            @RequestBody @Valid BarcodeProductNamesRequest request) {
        auth.require("products.read");
        return ApiResponse.ok(productService.findBySkus(request.skus()));
    }

    @PostMapping(value = "/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> generatePdf(@RequestBody @Valid BarcodePdfRequest request) {
        auth.require("products.read");
        byte[] pdf = service.generate(request);
        String fileName = "barcodes-" + FILE_TIMESTAMP.format(LocalDateTime.now()) + ".pdf";
        ContentDisposition disposition = ContentDisposition.inline().filename(fileName).build();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(pdf.length)
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .body(pdf);
    }
}
