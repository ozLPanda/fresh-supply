package kz.company.shop.supplierproducts;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class SupplierProductControllerTest {
    private final SupplierProductAccess access = mock(SupplierProductAccess.class);
    private final SupplierProductService service = mock(SupplierProductService.class);
    private final org.springframework.test.web.servlet.MockMvc mvc =
            MockMvcBuilders.standaloneSetup(new SupplierProductController(access, service))
                    .setControllerAdvice(new GlobalExceptionHandler())
                    .build();

    @Test
    void allReadsRequireAccessAndDisableCachingBeforeDatabaseWork() throws Exception {
        doThrow(new AppExceptions.Forbidden("pages.supplier-products.view"))
                .when(access)
                .requireRead();
        for (String path : new String[] {"", "/1", "/suppliers", "/imports", "/sync-status"})
            mvc.perform(get("/api/admin/supplier-products" + path))
                    .andExpect(status().isForbidden())
                    .andExpect(header().string("Cache-Control", "no-store"));
        verifyNoInteractions(service);
    }

    @Test
    void importsAndRetriesRequireOperationAccessBeforeEnqueueing() throws Exception {
        doThrow(new AppExceptions.Forbidden("supplier-products.import"))
                .when(access)
                .requireImport();
        mvc.perform(
                        post("/api/admin/supplier-products/imports")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"supplierCode\":\"mks\",\"scope\":\"SELECTED\",\"productIds\":[\"21\"]}"))
                .andExpect(status().isForbidden())
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(post("/api/admin/supplier-products/imports/1/retry"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }
}
