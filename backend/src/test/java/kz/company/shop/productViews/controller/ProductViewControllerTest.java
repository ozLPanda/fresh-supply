package kz.company.shop.common.security;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import kz.company.shop.auth.service.AuthService;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.productViews.controller.ProductViewController;
import kz.company.shop.productViews.dto.ProductViewAnalyticsDto;
import kz.company.shop.productViews.service.ProductViewService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(ProductViewController.class)
@Import({SecurityConfig.class, AuthFilter.class, AuthContext.class, SessionCookieService.class})
@TestPropertySource(
        properties = {
            "app.files.upload-dir=uploads",
            "app.cors.allowed-origins=http://localhost:5173",
            "app.auth.cookie.name=company_shop_session",
            "app.auth.cookie.path=/",
            "app.auth.cookie.secure=false",
            "app.auth.cookie.same-site=Strict",
            "app.auth.cookie.max-age-seconds=2592000"
        })
class ProductViewControllerTest {
    @Autowired private MockMvc mvc;

    @MockBean private AuthService authService;
    @MockBean private ProductViewService service;

    @Test
    void rejectsAnonymousViewAnalyticsRequest() throws Exception {
        mvc.perform(get("/api/products/view-analytics"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void returnsViewAnalyticsToUserWithProductsReadPermission() throws Exception {
        when(authService.resolve("allowed"))
                .thenReturn(Optional.of(userWithProductsReadPermission()));
        when(service.analytics(anyInt(), anyInt(), any(), isNull(), isNull()))
                .thenReturn(
                        new PageResult<>(
                                List.of(
                                        new ProductViewAnalyticsDto(
                                                42L, "42", "Насос", "Оборудование", 12L)),
                                1,
                                20,
                                1,
                                1));

        mvc.perform(
                        get("/api/products/view-analytics")
                                .param("search", "насос")
                                .header("Authorization", "Bearer allowed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].productId").value(42))
                .andExpect(jsonPath("$.data.items[0].views").value(12));

        verify(service).analytics(1, 20, "насос", null, null);
    }

    private CurrentUser userWithProductsReadPermission() {
        return new CurrentUser(
                1L,
                "user@example.com",
                "User",
                null,
                Set.of("products.read"),
                true,
                BigDecimal.ZERO);
    }
}
