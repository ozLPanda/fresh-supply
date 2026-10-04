package kz.company.shop.mks;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import kz.company.shop.common.exception.AppExceptions;
import org.junit.jupiter.api.Test;

class MksServiceTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final MksTransport transport = mock(MksTransport.class);
    private final MksService service =
            new MksService(transport, new MksParser(), "fixture-login", "fixture-password");

    private void init() throws Exception {
        when(transport.post(eq("/api/filterinit/"), anyMap()))
                .thenReturn(mapper.readTree("{\"catalog_tree\":[]}"));
    }

    private com.fasterxml.jackson.databind.JsonNode emptyProducts() throws Exception {
        // Synthetic fixture matching the verified response envelope; no live account data.
        return mapper.readTree(
                """
                {"products":{"data":[],"count":0,"pagination":{"page":"1","total":0,"perpage":20,"chunks":0,"next":false,"prev":false}},"params":{"maxmin":false}}
                """);
    }

    @Test
    void unconfiguredServiceNeverCallsSupplier() {
        var empty = new MksService(transport, new MksParser(), "", "");
        assertThat(empty.connect().configured()).isFalse();
        assertThatThrownBy(() -> empty.search(new MksDto.SearchRequest("", 1, 20, Map.of())))
                .isInstanceOf(AppExceptions.BadRequest.class);
        verifyNoInteractions(transport);
    }

    @Test
    void renewsExactlyOnceOnAuthenticationExpiry() throws Exception {
        init();
        when(transport.post(eq("/api/filter/"), anyMap()))
                .thenThrow(new MksTransport.Failure(true, "Сессия истекла"))
                .thenReturn(emptyProducts());
        assertThat(service.search(new MksDto.SearchRequest("", 1, 20, Map.of())).items()).isEmpty();
        verify(transport, times(2)).login("fixture-login", "fixture-password");
        verify(transport, times(2)).post(eq("/api/filter/"), anyMap());
        assertThat(service.status().connected()).isTrue();
    }

    @Test
    void stopsAfterSecondAuthenticationFailure() throws Exception {
        init();
        when(transport.post(eq("/api/filter/"), anyMap()))
                .thenThrow(new MksTransport.Failure(true, "Сессия истекла"));
        assertThatThrownBy(() -> service.search(new MksDto.SearchRequest("", 1, 20, Map.of())))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessage("Сессия истекла");
        verify(transport, times(2)).login("fixture-login", "fixture-password");
        verify(transport, times(2)).post(eq("/api/filter/"), anyMap());
        assertThat(service.status().connected()).isFalse();
    }

    @Test
    void alsoRenewsExpiredSessionWhenRestoringDynamicFilters() throws Exception {
        init();
        var baseline =
                mapper.readTree(
                        """
                {"products":{"data":[],"count":0,"pagination":{"page":"1","total":0,"perpage":20,"chunks":0,"next":false,"prev":false}},
                 "params":{"simple_params":[{"id":"power","header":"Мощность"}],"maxmin":{"power":{"minp":1,"maxp":100}}}}
                """);
        when(transport.post(eq("/api/filter/"), anyMap()))
                .thenThrow(new MksTransport.Failure(true, "Сессия истекла"))
                .thenReturn(baseline)
                .thenReturn(emptyProducts());
        service.search(new MksDto.SearchRequest("", 1, 20, Map.of("search_range.power.from", 5)));
        verify(transport, times(2)).login("fixture-login", "fixture-password");
        verify(transport)
                .post(
                        eq("/api/filter/"),
                        argThat(
                                payload ->
                                        payload.get("search_range")
                                                .equals(
                                                        Map.of(
                                                                "power",
                                                                Map.of(
                                                                        "from",
                                                                        new java.math.BigDecimal(
                                                                                "5"))))));
    }

    @Test
    void doesNotRetryNetworkFailuresOrExposeRawResponse() throws Exception {
        init();
        when(transport.post(eq("/api/filter/"), anyMap()))
                .thenThrow(new MksTransport.Failure(false, "Поставщик недоступен"));
        assertThatThrownBy(() -> service.search(new MksDto.SearchRequest("", 1, 20, Map.of())))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessage("Поставщик недоступен");
        verify(transport).login("fixture-login", "fixture-password");
        assertThat(service.status().connected()).isFalse();
    }

    @Test
    void rejectsMethodOverridesNestedValuesAndUnknownSorts() {
        for (var filters :
                java.util.List.of(
                        Map.<String, Object>of("method", "makeOrder"),
                        Map.<String, Object>of("catalog", Map.of("a", 1)),
                        Map.<String, Object>of("sorting", "injected-asc"))) {
            assertThatThrownBy(() -> service.payload(new MksDto.SearchRequest("", 1, 20, filters)))
                    .isInstanceOf(AppExceptions.BadRequest.class);
        }
        var payload =
                service.payload(
                        new MksDto.SearchRequest(
                                " drill ",
                                2,
                                20,
                                Map.of(
                                        "available",
                                        true,
                                        "minprice",
                                        100,
                                        "sorting",
                                        "price-asc")));
        assertThat(payload)
                .containsEntry("page", 2)
                .containsEntry("query", "drill")
                .containsEntry("byprice", 1)
                .containsEntry("catalog", "0");
        assertThat(payload.get("sorting")).isEqualTo(Map.of("field", "price", "sort", "asc"));
    }

    @Test
    void loadsModalProductViaGetAndRenewsExpiredSessionOnce() throws Exception {
        init();
        when(transport.get("/api/product/21/"))
                .thenThrow(new MksTransport.Failure(true, "Сессия истекла"))
                .thenReturn(mapper.readTree("{\"id\":\"21\",\"header\":\"Товар\"}"));
        assertThat(service.product("21").product().id()).isEqualTo("21");
        verify(transport, times(2)).login("fixture-login", "fixture-password");
        verify(transport, times(2)).get("/api/product/21/");
        assertThat(service.status().connected()).isTrue();
    }

    @Test
    void rejectsInvalidProductIdsBeforeCallingSupplierAndLimitsAuthenticationRetry() throws Exception {
        for (String id : new String[] {"../filter", "0", "1?method=makeOrder", "1/", "-1"}) {
            assertThatThrownBy(() -> service.product(id)).isInstanceOf(AppExceptions.BadRequest.class);
        }
        verifyNoInteractions(transport);
        init();
        when(transport.get("/api/product/21/"))
                .thenThrow(new MksTransport.Failure(true, "Сессия истекла"));
        assertThatThrownBy(() -> service.product("21"))
                .isInstanceOf(AppExceptions.BadRequest.class).hasMessage("Сессия истекла");
        verify(transport, times(2)).get("/api/product/21/");
        verify(transport, times(2)).login("fixture-login", "fixture-password");
        assertThat(service.status().connected()).isFalse();
    }
}
