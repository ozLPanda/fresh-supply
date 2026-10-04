package kz.company.shop.mks;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class MksControllerTest {
    private final MksAccess access = mock(MksAccess.class);
    private final MksService service = mock(MksService.class);
    private final org.springframework.test.web.servlet.MockMvc mvc =
            MockMvcBuilders.standaloneSetup(new MksController(access, service))
                    .setControllerAdvice(new GlobalExceptionHandler())
                    .build();

    @Test
    void everyEndpointChecksAccessBeforeSupplierWorkAndDoesNotCache() throws Exception {
        doThrow(new AppExceptions.Forbidden("pages.mks.view")).when(access).requireCatalogAccess();
        mvc.perform(get("/api/admin/mks/status"))
                .andExpect(status().isForbidden())
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(post("/api/admin/mks/connect"))
                .andExpect(status().isForbidden())
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get("/api/admin/mks/products/21"))
                .andExpect(status().isForbidden())
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(
                        post("/api/admin/mks/search")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"query\":\"\",\"page\":1,\"size\":20,\"filters\":{}}"))
                .andExpect(status().isForbidden())
                .andExpect(header().string("Cache-Control", "no-store"));
        verify(access, times(4)).requireCatalogAccess();
        verifyNoInteractions(service);
    }

    @Test
    void rejectsInvalidRequestSizesBeforeSupplierWork() throws Exception {
        mvc.perform(
                        post("/api/admin/mks/search")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"query\":\"\",\"page\":0,\"size\":9999,\"filters\":{}}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void productDetailsRequireCatalogAccessAndUseSupplierId() throws Exception {
        mvc.perform(get("/api/admin/mks/products/21"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"));
        var order = inOrder(access, service);
        order.verify(access).requireCatalogAccess();
        order.verify(service).product("21");
    }
}
