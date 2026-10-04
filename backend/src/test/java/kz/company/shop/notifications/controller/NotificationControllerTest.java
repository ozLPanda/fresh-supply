package kz.company.shop.notifications.controller;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.math.BigDecimal;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.notifications.config.WebPushProperties;
import kz.company.shop.notifications.service.NotificationService;
import kz.company.shop.notifications.service.WebPushSubscriptionService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class NotificationControllerTest {
    private final AuthContext auth = mock(AuthContext.class);
    private final WebPushSubscriptionService subscriptions = mock(WebPushSubscriptionService.class);
    private final WebPushProperties properties = new WebPushProperties();
    private final MockMvc mvc =
            MockMvcBuilders.standaloneSetup(
                            new NotificationController(
                                    mock(NotificationService.class),
                                    subscriptions,
                                    properties,
                                    auth))
                    .setControllerAdvice(new GlobalExceptionHandler())
                    .build();
    private final String subscription =
            """
            {"endpoint":"https://push.example/device","keys":{"p256dh":"key","auth":"auth"},"userId":999}
            """;

    @Test
    void customerWithoutOrderReadPermissionCanRegisterAndRemoveOnlyTheirDevice() throws Exception {
        when(auth.current())
                .thenReturn(
                        new CurrentUser(7L, "", "Клиент", "", Set.of(), false, BigDecimal.ZERO));
        properties.setPublicKey("public-key");
        properties.setPrivateKey("private-key");
        properties.setSubject("https://example.com");

        mvc.perform(get("/api/notifications/push-public-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.publicKey").value("public-key"));
        mvc.perform(
                        post("/api/notifications/push-subscriptions")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(subscription))
                .andExpect(status().isOk());
        mvc.perform(
                        delete("/api/notifications/push-subscriptions")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(subscription))
                .andExpect(status().isOk());

        verify(auth, never()).require(anyString());
        verify(subscriptions)
                .save(
                        eq(7L),
                        argThat(
                                request ->
                                        request.endpoint().equals("https://push.example/device")));
        verify(subscriptions).delete(eq(7L), any());
    }

    @Test
    void guestsCannotReadKeyRegisterOrDeleteSubscriptions() throws Exception {
        when(auth.current()).thenThrow(new AppExceptions.Forbidden("authenticated"));
        mvc.perform(get("/api/notifications/push-public-key")).andExpect(status().isForbidden());
        mvc.perform(
                        post("/api/notifications/push-subscriptions")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(subscription))
                .andExpect(status().isForbidden());
        mvc.perform(
                        delete("/api/notifications/push-subscriptions")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(subscription))
                .andExpect(status().isForbidden());
        verifyNoInteractions(subscriptions);
    }
}
