package kz.company.shop.common.security;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.Set;
import kz.company.shop.auth.service.AuthService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.products.controller.ProductController;
import kz.company.shop.products.dto.ProductListParams;
import kz.company.shop.products.service.ProductService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(ProductController.class)
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
class SecurityBoundaryTest {
    @Autowired private MockMvc mvc;

    @MockBean private AuthService authService;
    @MockBean private RateLimiter rateLimiter;
    @MockBean private ProductService productService;

    @Test
    void publicCatalogRemainsAccessibleWithoutAuthentication() throws Exception {
        mvc.perform(get("/api/products/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void storefrontRemainsAccessibleWithoutAuthentication() throws Exception {
        mvc.perform(get("/api/products/1/storefront"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        verify(productService).getPublic(1L, BigDecimal.ZERO);
    }

    @Test
    void unavailableStorefrontProductReturns404WithoutAuthentication() throws Exception {
        when(productService.getPublic(1L, BigDecimal.ZERO))
                .thenThrow(new AppExceptions.NotFound("Товар не найден"));

        mvc.perform(get("/api/products/1/storefront"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void publicCatalogCannotFilterProductsByMissingIncomingPrice() throws Exception {
        mvc.perform(get("/api/products?missingIncomingPrice=true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        ArgumentCaptor<ProductListParams> params = ArgumentCaptor.forClass(ProductListParams.class);
        verify(productService).list(params.capture(), any(BigDecimal.class));
        org.assertj.core.api.Assertions.assertThat(params.getValue().missingIncomingPrice())
                .isFalse();
    }

    @Test
    void userWithProductsReadCanFilterProductsByMissingIncomingPrice() throws Exception {
        when(authService.resolve("allowed"))
                .thenReturn(Optional.of(userWithPermissions(Set.of("products.read"))));

        mvc.perform(
                        get("/api/products?missingIncomingPrice=true")
                                .header("Authorization", "Bearer allowed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        ArgumentCaptor<ProductListParams> params = ArgumentCaptor.forClass(ProductListParams.class);
        verify(productService).list(params.capture(), any(BigDecimal.class));
        org.assertj.core.api.Assertions.assertThat(params.getValue().missingIncomingPrice())
                .isTrue();
    }

    @Test
    void protectedApiRejectsAnonymousRequestWithJson401() throws Exception {
        mvc.perform(delete("/api/products/1"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Authentication required"));
    }

    @Test
    void authenticatedUserWithoutPermissionGetsJson403() throws Exception {
        when(authService.resolve("no-permission"))
                .thenReturn(Optional.of(userWithPermissions(Set.of())));

        mvc.perform(delete("/api/products/1").header("Authorization", "Bearer no-permission"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Access denied"));
    }

    @Test
    void bearerUserWithPermissionCanUseProtectedEndpoint() throws Exception {
        when(authService.resolve("allowed"))
                .thenReturn(Optional.of(userWithPermissions(Set.of("products.delete"))));

        mvc.perform(delete("/api/products/1").header("Authorization", "Bearer allowed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        verify(productService).delete(1L);
    }

    @Test
    void cookieUserWithPermissionAndTrustedOriginCanUseProtectedEndpoint() throws Exception {
        when(authService.resolve("cookie-token"))
                .thenReturn(Optional.of(userWithPermissions(Set.of("products.delete"))));

        mvc.perform(
                        delete("/api/products/1")
                                .cookie(new Cookie("company_shop_session", "cookie-token"))
                                .header("Origin", "http://localhost:5173"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void cookieMutationFromUntrustedOriginIsRejected() throws Exception {
        mvc.perform(
                        delete("/api/products/1")
                                .cookie(new Cookie("company_shop_session", "cookie-token"))
                                .header("Origin", "https://attacker.example"))
                .andExpect(status().isForbidden())
                .andExpect(content().string("Invalid CORS request"));
    }

    @Test
    void cookieMutationWithoutOriginIsRejected() throws Exception {
        mvc.perform(
                        delete("/api/products/1")
                                .cookie(new Cookie("company_shop_session", "cookie-token")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("Untrusted request origin"));
    }

    private CurrentUser userWithPermissions(Set<String> permissions) {
        return new CurrentUser(
                1L, "user@example.com", "User", null, permissions, true, BigDecimal.ZERO);
    }
}
