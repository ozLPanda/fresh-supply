package kz.company.shop.warehouse.controller;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.dto.WarehouseDto.DocumentRequest;
import kz.company.shop.warehouse.service.PriceSettingGroupPdfService;
import kz.company.shop.warehouse.service.WarehouseBalancesPdfService;
import kz.company.shop.warehouse.service.WarehouseDocumentPdfService;
import kz.company.shop.warehouse.service.WarehouseService;
import kz.company.shop.warehouse.service.WarehouseLedgerReplayService;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Administrative API only. No stock/cost endpoint is placed below customer catalogue routes. */
@RestController
@RequestMapping("/api/admin/warehouse")
public class WarehouseController {
    private final WarehouseService service;
    private final PriceSettingGroupPdfService priceSettingGroupPdfService;
    private final WarehouseBalancesPdfService balancesPdfService;
    private final WarehouseDocumentPdfService documentPdfService;
    private final AuthContext auth;

    public WarehouseController(
            WarehouseService service,
            PriceSettingGroupPdfService priceSettingGroupPdfService,
            WarehouseBalancesPdfService balancesPdfService,
            WarehouseDocumentPdfService documentPdfService,
            AuthContext auth) {
        this.service = service;
        this.priceSettingGroupPdfService = priceSettingGroupPdfService;
        this.balancesPdfService = balancesPdfService;
        this.documentPdfService = documentPdfService;
        this.auth = auth;
    }

    @GetMapping("/balances")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.Balance>> balances() {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.balances(canReadCosts()));
    }

    @GetMapping(value = "/balances/export.pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ResponseEntity<byte[]> exportBalancesPdf(
            @RequestParam(defaultValue = "STANDARD") WarehouseBalancesPdfService.Mode mode,
            @RequestParam(defaultValue = "ALL") WarehouseBalancesPdfService.StockFilter stockFilter,
            @RequestParam(required = false) String search) {
        auth.require("warehouse.read");
        byte[] pdf = balancesPdfService.generate(mode, stockFilter, search);
        String filename =
                mode == WarehouseBalancesPdfService.Mode.INVENTORY
                        ? "warehouse-inventory.pdf"
                        : "warehouse-balances.pdf";
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(pdf.length)
                .cacheControl(CacheControl.noStore())
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(filename).build().toString())
                .body(pdf);
    }

    @GetMapping("/stock-shortages")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.StockShortageRelease>> stockShortages() {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.stockShortageReleases());
    }

    @GetMapping("/balances/{productId}/reservations")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<WarehouseDto.ProductReservations> reservations(
            @PathVariable Long productId) {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.reservationsForProduct(productId));
    }

    @GetMapping("/balances/{productId}/movements")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<WarehouseDto.ProductMovements> movements(@PathVariable Long productId) {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.movementsForProduct(productId));
    }

    /** Computes the existing ledger without changing movements, parties, orders or prices. */
    @GetMapping("/balances/{productId}/recalculation-preview")
    @PreAuthorize("hasAuthority('warehouse.read') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<WarehouseLedgerReplayService.ReplayPreview> recalculationPreview(
            @PathVariable Long productId) {
        auth.require("warehouse.read");
        auth.require("warehouse.costs.read");
        return ApiResponse.ok(service.previewLedger(productId));
    }

    @GetMapping("/products")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.ProductPickerItem>> productPicker(
            @RequestParam(required = false) String search) {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.productPicker(search));
    }

    @GetMapping("/documents")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.DocumentSummary>> listDocuments() {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.listDocuments());
    }

    @GetMapping("/counterparties")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.Counterparty>> counterparties(
            @RequestParam(defaultValue = "false") boolean includeArchived) {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.listCounterparties(includeArchived));
    }

    @PostMapping("/counterparties")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Counterparty> createCounterparty(
            @RequestBody @Valid WarehouseDto.CounterpartyRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.createCounterparty(request));
    }

    @PutMapping("/counterparties/{id}")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Counterparty> updateCounterparty(
            @PathVariable UUID id, @RequestBody @Valid WarehouseDto.CounterpartyRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.updateCounterparty(id, request));
    }

    @GetMapping("/price-setting-groups")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.PriceSettingGroup>> priceSettingGroups() {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.listPriceSettingGroups());
    }

    @GetMapping(
            value = "/price-setting-groups/{id}/export.pdf",
            produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ResponseEntity<byte[]> priceSettingGroupPdf(@PathVariable UUID id) {
        auth.require("warehouse.read");
        byte[] pdf = priceSettingGroupPdfService.generate(id);
        ContentDisposition disposition =
                ContentDisposition.attachment()
                        .filename("ustanovka-cen-gruppa-" + id + ".pdf")
                        .build();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(pdf.length)
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .body(pdf);
    }

    @PostMapping("/price-setting-groups")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.PriceSettingGroup> createPriceSettingGroup(
            @RequestBody @Valid WarehouseDto.PriceSettingGroupRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.createPriceSettingGroup(request, auth.current()));
    }

    @PutMapping("/price-setting-groups/{id}")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.PriceSettingGroup> updatePriceSettingGroup(
            @PathVariable UUID id,
            @RequestBody @Valid WarehouseDto.PriceSettingGroupRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.updatePriceSettingGroup(id, request));
    }

    @PostMapping("/price-setting-groups/{id}/post")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<Integer> postPriceSettingGroup(@PathVariable UUID id) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.postPriceSettingGroup(id, auth.current()));
    }

    @PostMapping("/price-setting-groups/{id}/cancel")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<Integer> cancelPriceSettingGroup(@PathVariable UUID id) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.cancelPriceSettingGroup(id, auth.current()));
    }

    @DeleteMapping("/price-setting-groups/{id}/documents")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<Integer> deletePriceSettingGroupDocuments(@PathVariable UUID id) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.softDeletePriceSettingGroupDocuments(id, auth.current()));
    }

    @GetMapping("/documents/{id}/ai-price-group")
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<WarehouseDto.AiPriceGroupSelection> aiPriceGroupSelection(@PathVariable UUID id) {
        auth.require("warehouse.manage");
        auth.require("warehouse.costs.read");
        return ApiResponse.ok(service.getAiPriceGroupSelection(id));
    }

    @PutMapping("/documents/{id}/ai-price-group")
    @PreAuthorize("hasAuthority('warehouse.manage') and hasAuthority('warehouse.costs.read')")
    public ApiResponse<WarehouseDto.AiPriceGroupSelection> selectAiPriceGroup(@PathVariable UUID id,
            @RequestBody WarehouseDto.AiPriceGroupSelectionRequest request) {
        auth.require("warehouse.manage");
        auth.require("warehouse.costs.read");
        return ApiResponse.ok(service.selectAiPriceGroup(id, request.groupId(), auth.current()));
    }

    @PostMapping("/price-setting-preview")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<List<WarehouseDto.PriceSettingPreviewLine>> previewPriceSetting(
            @RequestBody @Valid DocumentRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.previewPriceSetting(request));
    }

    @GetMapping("/products/{productId}/clean-incoming-price-history")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.CleanIncomingPriceHistoryPoint>> cleanIncomingPriceHistory(
            @PathVariable Long productId) {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.cleanIncomingPriceHistory(productId, canReadCosts()));
    }

    @GetMapping("/documents/{id}")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<WarehouseDto.Document> document(@PathVariable UUID id) {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.getDocument(id, canReadCosts()));
    }

    @GetMapping(value = "/documents/{id}/export.pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ResponseEntity<byte[]> documentPdf(@PathVariable UUID id) {
        auth.require("warehouse.read");
        byte[] pdf = documentPdfService.generate(id);
        ContentDisposition disposition =
                ContentDisposition.attachment()
                        .filename("warehouse-document-" + id + ".pdf")
                        .build();
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(pdf.length)
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .body(pdf);
    }

    @GetMapping("/documents/{id}/history")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.DocumentVersion>> documentHistory(@PathVariable UUID id) {
        auth.require("warehouse.read");
        return ApiResponse.ok(service.documentHistory(id, canReadCosts()));
    }

    @GetMapping("/documents/{id}/purchase-order-progress")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<WarehouseDto.PurchaseOrderProgress> purchaseOrderProgress(
            @PathVariable UUID id) {
        return ApiResponse.ok(service.purchaseOrderProgress(id));
    }

    @GetMapping("/purchase-order-remainders")
    @PreAuthorize("hasAuthority('warehouse.read')")
    public ApiResponse<List<WarehouseDto.PurchaseOrderRemainder>> purchaseOrderRemainders(
            @RequestParam(required = false) UUID excludeDocumentId) {
        return ApiResponse.ok(service.availablePurchaseOrders(excludeDocumentId, canReadCosts()));
    }

    @PostMapping("/documents/{id}/receipt")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Document> createReceipt(@PathVariable UUID id) {
        return ApiResponse.ok(
                service.createReceiptFromPurchaseOrder(id, auth.current(), canReadCosts()));
    }

    @PostMapping("/documents")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Document> create(@RequestBody @Valid DocumentRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.createDraft(request, auth.current(), canReadCosts()));
    }

    @PostMapping("/documents/{id}/order-from-remaining")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Document> createOrderFromRemaining(
            @PathVariable UUID id,
            @RequestBody @Valid WarehouseDto.RemainingPurchaseOrderRequest request) {
        return ApiResponse.ok(
                service.createPurchaseOrderFromRemaining(
                        id, request.counterpartyId(), auth.current(), canReadCosts()));
    }

    @PutMapping("/documents/{id}")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Document> update(
            @PathVariable UUID id, @RequestBody @Valid DocumentRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.updateDraft(id, request, auth.current(), canReadCosts()));
    }

    @PostMapping("/documents/{id}/post")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Document> post(@PathVariable UUID id) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.post(id, auth.current(), canReadCosts()));
    }

    @PostMapping("/documents/{id}/save-and-post")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Document> saveAndPost(
            @PathVariable UUID id, @RequestBody @Valid DocumentRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.saveAndPost(id, request, auth.current(), canReadCosts()));
    }

    @PostMapping("/documents/{id}/cancel")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<WarehouseDto.Document> cancel(@PathVariable UUID id) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.cancel(id, auth.current(), canReadCosts()));
    }

    @DeleteMapping("/documents/{id}")
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<Void> delete(@PathVariable UUID id) {
        auth.require("warehouse.manage");
        service.softDelete(id, auth.current());
        return ApiResponse.ok(null);
    }

    private boolean canReadCosts() {
        return auth.current().permissions().contains("warehouse.costs.read");
    }
}
