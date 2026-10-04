package kz.company.shop.warehouse.ai;

import java.util.UUID;
import java.util.List;
import java.util.EnumMap;
import java.util.Map;
import java.math.BigDecimal;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.service.PriceSettingGroupPdfService;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/warehouse")
public class AiPriceSessionController {
    private final AiPriceSessionService service;
    private final AuthContext auth;
    private final PriceSettingGroupPdfService pdfService;

    public AiPriceSessionController(AiPriceSessionService service, AuthContext auth,
            PriceSettingGroupPdfService pdfService) {
        this.service = service;
        this.auth = auth;
        this.pdfService = pdfService;
    }

    @PostMapping({"/receipts/{receiptId}/ai-price-sessions", "/price-sources/{receiptId}/ai-price-sessions"})
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<AiPriceDto.Session> start(@PathVariable UUID receiptId,
            @RequestBody AiPriceDto.StartRequest request) {
        requireAccess();
        return ApiResponse.ok(service.start(receiptId, request.groupId(), request.message(), auth.current()));
    }

    @GetMapping("/ai-price-sessions/{sessionId}")
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<AiPriceDto.Session> get(@PathVariable UUID sessionId) {
        requireAccess();
        return ApiResponse.ok(service.get(sessionId));
    }

    @GetMapping(value = "/ai-price-sessions/{sessionId}/preview.pdf",
            produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ResponseEntity<byte[]> previewPdf(@PathVariable UUID sessionId) {
        requireAccess();
        AiPriceDto.Session session = service.get(sessionId);
        if (!"PREVIEW".equals(session.status()))
            throw new AppExceptions.BadRequest("Таблица цен ещё не готова к просмотру");
        List<PriceSettingGroupPdfService.PreviewRow> rows = session.rows().stream().map(row -> {
            Map<StockDocumentPriceType, BigDecimal> newer = new EnumMap<>(StockDocumentPriceType.class);
            Map<StockDocumentPriceType, BigDecimal> older = new EnumMap<>(StockDocumentPriceType.class);
            row.prices().forEach((type, price) -> {
                newer.put(type, price.newPrice());
                older.put(type, price.oldPrice());
            });
            return new PriceSettingGroupPdfService.PreviewRow(
                    row.sku(), row.productName(), newer, older);
        }).toList();
        byte[] pdf = pdfService.generatePreview(session.groupName(), rows);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(pdf.length)
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.inline().filename("ustanovka-cen-predprosmotr-" + sessionId + ".pdf").build().toString())
                .body(pdf);
    }

    @PostMapping("/ai-price-sessions/{sessionId}/messages")
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<AiPriceDto.Session> message(@PathVariable UUID sessionId,
            @RequestBody AiPriceDto.MessageRequest request) {
        requireAccess();
        return ApiResponse.ok(service.message(sessionId, request.message()));
    }

    @PutMapping("/ai-price-sessions/{sessionId}/prices")
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<AiPriceDto.Session> edit(@PathVariable UUID sessionId,
            @RequestBody AiPriceDto.EditRequest request) {
        requireAccess();
        return ApiResponse.ok(service.edit(sessionId, request.rows()));
    }

    @PostMapping("/ai-price-sessions/{sessionId}/confirm")
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<AiPriceDto.Session> confirm(@PathVariable UUID sessionId) {
        requireAccess();
        return ApiResponse.ok(service.confirm(sessionId, auth.current()));
    }

    @PostMapping("/ai-price-sessions/{sessionId}/regenerate")
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<AiPriceDto.Session> regenerate(@PathVariable UUID sessionId,
            @RequestBody(required = false) AiPriceDto.RegenerateRequest request) {
        requireAccess();
        return ApiResponse.ok(service.regenerate(sessionId, request == null ? null : request.message(), auth.current()));
    }

    private void requireAccess() {
        auth.require("warehouse.manage");
        auth.require("warehouse.costs.read");
    }
}
