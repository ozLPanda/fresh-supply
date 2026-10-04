package kz.company.shop.regularbuyers.controller;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.regularbuyers.service.RegularBuyerService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RegularBuyerControllerTest {
    private final RegularBuyerService service = mock(RegularBuyerService.class);
    private final AuthContext auth = mock(AuthContext.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new RegularBuyerController(service, auth))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        signedIn(Set.of());
        when(service.list(anyBoolean())).thenReturn(List.of());
    }

    @Test
    void pickerAllowsOrderEditorsAndReadRequiresOwnPermission() throws Exception {
        signedIn(Set.of("orders.update"));
        mvc.perform(get("/api/admin/regular-buyers")).andExpect(status().isOk());
        verify(service).list(false);
        verify(auth, never()).require(anyString());
        signedIn(Set.of("regular-buyers.manage"));
        mvc.perform(get("/api/admin/regular-buyers?includeArchived=true")).andExpect(status().isOk());
        verify(service).list(true);
        signedIn(Set.of("regular-buyers.read"));
        mvc.perform(get("/api/admin/regular-buyers")).andExpect(status().isOk());
        verify(auth).require("regular-buyers.read");
    }

    @Test
    void deniesDirectoryReadAndWriteWhenPermissionsAreMissing() throws Exception {
        doThrow(new AppExceptions.Forbidden("regular-buyers.read")).when(auth).require("regular-buyers.read");
        mvc.perform(get("/api/admin/regular-buyers")).andExpect(status().isForbidden());
        doThrow(new AppExceptions.Forbidden("regular-buyers.manage")).when(auth).require("regular-buyers.manage");
        mvc.perform(post("/api/admin/regular-buyers").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"ИП Получатель\"}"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void validatesNameLengthAndEmailBeforeSaving() throws Exception {
        for (String body : List.of("{\"name\":\"   \"}", "{\"name\":\"" + "x".repeat(241) + "\"}",
                "{\"name\":\"ИП Получатель\",\"email\":\"invalid\"}")) {
            mvc.perform(post("/api/admin/regular-buyers").contentType(MediaType.APPLICATION_JSON)
                            .content(body)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
    }

    private void signedIn(Set<String> permissions) {
        when(auth.current()).thenReturn(new CurrentUser(7L, "admin@example.com", "Admin", null,
                permissions, true, BigDecimal.ZERO));
    }

    @Test
    void rejectsInvalidTaxIdsAndOverlongLegalAddress() throws Exception {
        for (String taxId : List.of("123", "1234567890123", "12345678901a", "１２３４５６７８９０１２")) {
            mvc.perform(post("/api/admin/regular-buyers").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"name\":\"Покупатель\",\"taxId\":\"" + taxId + "\"}"))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(put("/api/admin/regular-buyers/00000000-0000-0000-0000-000000000001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Покупатель\",\"legalAddress\":\"" + "x".repeat(1001) + "\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void acceptsMissingBlankAndTrimmedPaymentDetails() throws Exception {
        for (String details : List.of("", ",\"taxId\":null,\"legalAddress\":null",
                ",\"taxId\":\"  \",\"legalAddress\":\"  \"",
                ",\"taxId\":\"  012345678901  \",\"legalAddress\":\"  Адрес  \"")) {
            mvc.perform(post("/api/admin/regular-buyers").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"name\":\"Покупатель\"" + details + "}"))
                    .andExpect(status().isOk());
        }
        verify(service, times(3)).create(argThat(request -> request.taxId() == null && request.legalAddress() == null));
        verify(service).create(argThat(request -> "012345678901".equals(request.taxId())
                && "Адрес".equals(request.legalAddress())));
    }
}
