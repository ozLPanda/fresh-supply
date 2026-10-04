package kz.company.shop.orders.ai;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.UUID;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OrderAssistantControllerTest {
    final OrderAssistantService service = mock(OrderAssistantService.class);
    MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc =
                MockMvcBuilders.standaloneSetup(new OrderAssistantController(service))
                        .setControllerAdvice(new GlobalExceptionHandler())
                        .build();
    }

    @Test
    void checkoutValidatesNestedNormalOrderFormBeforeCallingService() throws Exception {
        String valid =
                "{\"priceTier\":\"RETAIL\",\"orderDate\":\"2026-01-01\",\"items\":[{\"productId\":1,\"quantity\":2,\"unitPrice\":10,\"measurementUnit\":\"KG\"}]}";
        for (String invalid :
                List.of(
                        "null",
                        "{}",
                        valid.replace("\"quantity\":2", "\"quantity\":0"),
                        valid.replace("\"unitPrice\":10", "\"unitPrice\":-1"),
                        valid.replace("\"productId\":1", "\"productId\":null"))) {
            mvc.perform(
                            post("/api/admin/order-assistant/sessions/"
                                            + UUID.randomUUID()
                                            + "/checkout")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"revision\":0,\"order\":" + invalid + "}"))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(service);
        mvc.perform(
                        post("/api/admin/order-assistant/sessions/"
                                        + UUID.randomUUID()
                                        + "/checkout")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"revision\":0,\"order\":" + valid + "}"))
                .andExpect(status().isOk());
        verify(service).checkout(any(), argThat(request -> request.order().items().size() == 1));
    }
}
