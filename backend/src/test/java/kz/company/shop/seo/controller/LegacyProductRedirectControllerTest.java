package kz.company.shop.seo.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class LegacyProductRedirectControllerTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final MockMvc mvc =
            MockMvcBuilders.standaloneSetup(new LegacyProductRedirectController(jdbc)).build();

    @Test
    void indexedUrlRedirectsToMappedProductAndDropsTrackingQuery() throws Exception {
        when(jdbc.queryForList(anyString(), eq(Long.class), eq("131540811")))
                .thenReturn(List.of(1810L));

        mvc.perform(get("/p131540811-rezba-kor-chernaya.html?utm_source=google"))
                .andExpect(status().isMovedPermanently())
                .andExpect(header().string("Location", "/product/1810"))
                .andExpect(header().string("Cache-Control", "no-store"));

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForList(sql.capture(), eq(Long.class), eq("131540811"));
        assertThat(sql.getValue())
                .contains(
                        "from legacy_product_urls legacy",
                        "join products p on p.id = legacy.product_id",
                        "legacy.legacy_id = ?",
                        "p.active = true",
                        "p.deleted_at is null");
    }

    @Test
    void changedSlugStillUsesTheVerifiedLegacyId() throws Exception {
        when(jdbc.queryForList(anyString(), eq(Long.class), eq("131540811")))
                .thenReturn(List.of(1810L));

        mvc.perform(get("/p131540811-an-older-name.html"))
                .andExpect(status().isMovedPermanently())
                .andExpect(header().string("Location", "/product/1810"));
    }

    @Test
    void legacyUrlWithoutSlugAlsoRedirects() throws Exception {
        when(jdbc.queryForList(anyString(), eq(Long.class), eq("131540811")))
                .thenReturn(List.of(1810L));

        mvc.perform(get("/p131540811.html"))
                .andExpect(status().isMovedPermanently())
                .andExpect(header().string("Location", "/product/1810"));
    }

    @Test
    void unknownOrUnavailableMappingReturnsUncacheableNonindexed404() throws Exception {
        when(jdbc.queryForList(anyString(), eq(Long.class), eq("999999999")))
                .thenReturn(List.of());

        mvc.perform(get("/p999999999-missing.html"))
                .andExpect(status().isNotFound())
                .andExpect(header().doesNotExist("Location"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Robots-Tag", "noindex"));
    }

    @Test
    void databaseFailureDoesNotMisreportProductAsDeleted() throws Exception {
        when(jdbc.queryForList(anyString(), eq(Long.class), eq("131540811")))
                .thenThrow(new DataAccessResourceFailureException("Database unavailable"));

        mvc.perform(get("/p131540811-rezba-kor-chernaya.html"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().doesNotExist("Location"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Robots-Tag", "noindex"));
    }
}
