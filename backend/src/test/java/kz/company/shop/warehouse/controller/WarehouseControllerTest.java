package kz.company.shop.warehouse.controller;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.warehouse.service.PriceSettingGroupPdfService;
import kz.company.shop.warehouse.service.WarehouseBalancesPdfService;
import kz.company.shop.warehouse.service.WarehouseDocumentPdfService;
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class WarehouseControllerTest {
    private final WarehouseService warehouse = mock(WarehouseService.class);
    private final WarehouseBalancesPdfService balancesPdf = mock(WarehouseBalancesPdfService.class);
    private final WarehouseDocumentPdfService documentPdf = mock(WarehouseDocumentPdfService.class);
    private final AuthContext auth = mock(AuthContext.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc =
                MockMvcBuilders.standaloneSetup(
                                new WarehouseController(
                                        warehouse,
                                        mock(PriceSettingGroupPdfService.class),
                                        balancesPdf,
                                        documentPdf,
                                        auth))
                        .setControllerAdvice(new GlobalExceptionHandler())
                        .build();
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                7L,
                                "admin@example.test",
                                "Администратор",
                                null,
                                Set.of("warehouse.read"),
                                true,
                                BigDecimal.ZERO));
    }

    @Test
    void documentExportChecksWarehouseReadAndReturnsPdfDownload() throws Exception {
        java.util.UUID id = java.util.UUID.randomUUID();
        byte[] pdf = "%PDF-document".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        when(documentPdf.generate(id)).thenReturn(pdf);

        mvc.perform(get("/api/admin/warehouse/documents/{id}/export.pdf", id))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(
                        header().string(
                                        "Content-Disposition",
                                        org.hamcrest.Matchers.containsString(
                                                "warehouse-document-" + id + ".pdf")))
                .andExpect(content().bytes(pdf));

        verify(auth).require("warehouse.read");
        verify(documentPdf).generate(id);
    }

    @Test
    void inventoryExportChecksWarehouseReadAndReturnsPdfDownload() throws Exception {
        byte[] pdf = "%PDF-inventory".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        when(balancesPdf.generate(
                        WarehouseBalancesPdfService.Mode.INVENTORY,
                        WarehouseBalancesPdfService.StockFilter.BELOW_10,
                        "насос"))
                .thenReturn(pdf);

        mvc.perform(
                        get("/api/admin/warehouse/balances/export.pdf")
                                .param("mode", "INVENTORY")
                                .param("stockFilter", "BELOW_10")
                                .param("search", "насос"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(
                        header().string(
                                        "Content-Disposition",
                                        org.hamcrest.Matchers.containsString(
                                                "attachment; filename=\"warehouse-inventory.pdf\"")))
                .andExpect(content().bytes(pdf));

        verify(auth).require("warehouse.read");
        verify(balancesPdf)
                .generate(
                        WarehouseBalancesPdfService.Mode.INVENTORY,
                        WarehouseBalancesPdfService.StockFilter.BELOW_10,
                        "насос");
    }

    @Test
    void priceSettingGroupActionsUseManagePermissionAndReturnChangedCount() throws Exception {
        UUID id = UUID.randomUUID();
        CurrentUser actor = auth.current();
        when(warehouse.postPriceSettingGroup(id, actor)).thenReturn(2);
        when(warehouse.cancelPriceSettingGroup(id, actor)).thenReturn(1);
        when(warehouse.softDeletePriceSettingGroupDocuments(id, actor)).thenReturn(3);

        mvc.perform(post("/api/admin/warehouse/price-setting-groups/{id}/post", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(2));
        mvc.perform(post("/api/admin/warehouse/price-setting-groups/{id}/cancel", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(1));
        mvc.perform(delete("/api/admin/warehouse/price-setting-groups/{id}/documents", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").value(3));

        verify(auth, org.mockito.Mockito.times(3)).require("warehouse.manage");
        verify(warehouse).postPriceSettingGroup(id, actor);
        verify(warehouse).cancelPriceSettingGroup(id, actor);
        verify(warehouse).softDeletePriceSettingGroupDocuments(id, actor);
    }
}
