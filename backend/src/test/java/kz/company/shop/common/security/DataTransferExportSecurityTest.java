package kz.company.shop.common.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.Set;
import kz.company.shop.auth.service.AuthService;
import kz.company.shop.datatransfer.DataTransferBarrier;
import kz.company.shop.datatransfer.DataTransferExportController;
import kz.company.shop.datatransfer.DataTransferExportService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DataTransferExportController.class)
@Import({SecurityConfig.class, AuthFilter.class, AuthContext.class, SessionCookieService.class})
@TestPropertySource(
        properties = {
            "app.cors.allowed-origins=http://localhost:5173",
            "app.auth.cookie.name=company_shop_session",
            "app.auth.cookie.path=/",
            "app.auth.cookie.secure=false",
            "app.auth.cookie.same-site=Strict",
            "app.auth.cookie.max-age-seconds=2592000"
        })
class DataTransferExportSecurityTest {
    @Autowired private MockMvc mvc;
    @MockBean private AuthService authService;
    @MockBean private RateLimiter limiter;
    @MockBean private DataTransferExportService exporter;
    @MockBean private DataTransferBarrier barrier;
    @TempDir Path directory;

    @Test
    void anonymousExportIsRejectedBeforeReadingDatabaseOrFiles() throws Exception {
        mvc.perform(get("/api/data-transfer/export")).andExpect(status().isUnauthorized());
        verifyNoInteractions(exporter);
    }

    @Test
    void adminInterfaceAccessDoesNotGrantFullExport() throws Exception {
        when(authService.resolve(anyString()))
                .thenReturn(Optional.of(user(Set.of("pages.settings.view"))));
        mvc.perform(get("/api/data-transfer/export").header("Authorization", "Bearer fixture"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("Недостаточно прав: data.export"));
        verifyNoInteractions(exporter);
    }

    @Test
    void permissionAllowsBearerDownloadAndTemporaryArchiveIsRemoved() throws Exception {
        Path archive = fixtureArchive();
        mvc.perform(get("/api/data-transfer/export").header("Authorization", "Bearer fixture"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/zip"))
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(content().bytes(new byte[] {1, 2, 3}));
        assertThat(archive).doesNotExist();
    }

    @Test
    void permissionAllowsNormalWebsiteSessionCookieDownload() throws Exception {
        Path archive = fixtureArchive();
        mvc.perform(
                        get("/api/data-transfer/export")
                                .cookie(new Cookie("company_shop_session", "fixture")))
                .andExpect(status().isOk());
        assertThat(archive).doesNotExist();
    }

    private Path fixtureArchive() throws Exception {
        Path archive = directory.resolve("snapshot.zip");
        Files.write(archive, new byte[] {1, 2, 3});
        when(authService.resolve(anyString())).thenReturn(Optional.of(user(Set.of("data.export"))));
        when(exporter.export()).thenReturn(new DataTransferExportService.Archive(archive, 3));
        return archive;
    }

    private CurrentUser user(Set<String> permissions) {
        return new CurrentUser(
                1L, "fixture@example.invalid", "Fixture", null, permissions, true, BigDecimal.ZERO);
    }
}
