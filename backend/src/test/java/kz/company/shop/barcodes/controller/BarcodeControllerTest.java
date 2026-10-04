package kz.company.shop.barcodes.controller;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import kz.company.shop.barcodes.dto.BarcodePdfMode;
import kz.company.shop.barcodes.dto.BarcodePdfRequest;
import kz.company.shop.barcodes.service.BarcodePdfService;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.products.service.ProductService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class BarcodeControllerTest {
    private final BarcodePdfService service = mock(BarcodePdfService.class);
    private final ProductService productService = mock(ProductService.class);
    private final AuthContext auth = mock(AuthContext.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc =
                MockMvcBuilders.standaloneSetup(
                                new BarcodeController(service, productService, auth))
                        .setControllerAdvice(new GlobalExceptionHandler())
                        .build();
    }

    @Test
    void generateReturnsInlinePdfAndChecksReadPermission() throws Exception {
        byte[] pdf = "%PDF-test".getBytes();
        when(service.generate(any())).thenReturn(pdf);

        mvc.perform(
                        post("/api/admin/barcodes/pdf")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"items":[{"value":"12345","quantity":2}]}
                                        """))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                .andExpect(content().bytes(pdf))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(
                        header().string(
                                        HttpHeaders.CONTENT_DISPOSITION,
                                        containsString("inline; filename=\"barcodes-")));

        verify(auth).require("products.read");
        verify(service).generate(any());
    }

    @Test
    void generateIgnoresLegacyProductNameRegardlessOfItsLength() throws Exception {
        byte[] pdf = "%PDF-test".getBytes();
        when(service.generate(any())).thenReturn(pdf);

        mvc.perform(
                        post("/api/admin/barcodes/pdf")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"mode":"WITH_NAME","items":[{"value":"12345","name":"%s","quantity":1}]}
                                        """
                                                .formatted("x".repeat(500))))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF));

        verify(auth).require("products.read");
        ArgumentCaptor<BarcodePdfRequest> request =
                ArgumentCaptor.forClass(BarcodePdfRequest.class);
        verify(service).generate(request.capture());
        org.assertj.core.api.Assertions.assertThat(request.getValue().mode())
                .isEqualTo(BarcodePdfMode.WITH_NAME);
        org.assertj.core.api.Assertions.assertThat(request.getValue().items().getFirst().name())
                .hasSize(500);
    }

    @Test
    void generateDefaultsMissingModeToCompact() throws Exception {
        when(service.generate(any())).thenReturn("%PDF-test".getBytes());

        mvc.perform(
                        post("/api/admin/barcodes/pdf")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"items\":[{\"value\":\"12345\",\"quantity\":1}]}"))
                .andExpect(status().isOk());

        ArgumentCaptor<BarcodePdfRequest> request =
                ArgumentCaptor.forClass(BarcodePdfRequest.class);
        verify(service).generate(request.capture());
        org.assertj.core.api.Assertions.assertThat(request.getValue().effectiveMode())
                .isEqualTo(BarcodePdfMode.COMPACT);
        org.assertj.core.api.Assertions.assertThat(
                        request.getValue().shouldExcludeIncompleteSheet())
                .isFalse();
    }

    @Test
    void generatePassesExcludeIncompleteSheetOptionToService() throws Exception {
        when(service.generate(any())).thenReturn("%PDF-test".getBytes());

        mvc.perform(
                        post("/api/admin/barcodes/pdf")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"items":[{"value":"12345","quantity":36}],"excludeIncompleteSheet":true}
                                        """))
                .andExpect(status().isOk());

        ArgumentCaptor<BarcodePdfRequest> request =
                ArgumentCaptor.forClass(BarcodePdfRequest.class);
        verify(service).generate(request.capture());
        org.assertj.core.api.Assertions.assertThat(
                        request.getValue().shouldExcludeIncompleteSheet())
                .isTrue();
    }

    @Test
    void generateRejectsEmptyItemsBeforeCallingService() throws Exception {
        mvc.perform(
                        post("/api/admin/barcodes/pdf")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"items\":[]}"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(auth, service);
    }
}
