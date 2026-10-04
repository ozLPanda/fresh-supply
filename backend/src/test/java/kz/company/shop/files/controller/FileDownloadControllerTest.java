package kz.company.shop.files.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayInputStream;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.files.service.ObjectStorageService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class FileDownloadControllerTest {
    private final ObjectStorageService storage =
            org.mockito.Mockito.mock(ObjectStorageService.class);
    private final MockMvc mvc =
            MockMvcBuilders.standaloneSetup(new FileDownloadController(storage))
                    .setControllerAdvice(new GlobalExceptionHandler())
                    .build();

    @Test
    void streamsImageFromObjectStorage() throws Exception {
        byte[] bytes = {1, 2, 3};
        when(storage.get("uploads/example.png"))
                .thenReturn(
                        new ObjectStorageService.StoredObject(
                                new ByteArrayInputStream(bytes), bytes.length, "image/png"));

        mvc.perform(get("/uploads/example.png"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/png"))
                .andExpect(
                        header().string("Content-Disposition", "inline; filename=\"example.png\""))
                .andExpect(content().bytes(bytes));

        verify(storage).get("uploads/example.png");
    }

    @Test
    void downloadsDocumentsAsAttachments() throws Exception {
        byte[] bytes = {4, 5};
        when(storage.get("uploads/files/price.pdf"))
                .thenReturn(
                        new ObjectStorageService.StoredObject(
                                new ByteArrayInputStream(bytes), bytes.length, "application/pdf"));

        mvc.perform(get("/uploads/files/price.pdf"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/pdf"))
                .andExpect(
                        header().string(
                                        "Content-Disposition",
                                        "attachment; filename=\"price.pdf\""))
                .andExpect(content().bytes(bytes));
    }

    @Test
    void rejectsPathTraversalBeforeCallingStorage() throws Exception {
        mvc.perform(get("/uploads/%2e%2e/secret.pdf")).andExpect(status().isNotFound());
    }
}
