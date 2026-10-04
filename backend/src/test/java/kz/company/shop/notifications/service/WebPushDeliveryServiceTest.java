package kz.company.shop.notifications.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.UUID;
import kz.company.shop.notifications.config.WebPushProperties;
import kz.company.shop.notifications.entity.WebPushSubscription;
import kz.company.shop.notifications.repository.WebPushSubscriptionRepository;
import nl.martijndwars.webpush.Encoding;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.apache.http.HttpResponse;
import org.apache.http.StatusLine;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class WebPushDeliveryServiceTest {
    @BeforeEach
    void installCryptoProvider() {
        java.security.Security.addProvider(new BouncyCastleProvider());
    }

    private final WebPushSubscriptionRepository repository =
            mock(WebPushSubscriptionRepository.class);
    private final PushService transport = mock(PushService.class);
    private final WebPushProperties properties = new WebPushProperties();
    private final WebPushDeliveryService service =
            new WebPushDeliveryService(repository, properties, new ObjectMapper()) {
                @Override
                PushService createPushService() {
                    return transport;
                }
            };

    private final UUID orderId = UUID.randomUUID();

    @Test
    void skipsDeliveryWithoutServerConfiguration() {
        service.deliverNewOrder(orderId, "123", List.of(7L));
        verifyNoInteractions(repository, transport);
    }

    @Test
    void skipsDeliveryWithoutRecipients() {
        configured();
        service.deliverNewOrder(orderId, "123", List.of());
        verifyNoInteractions(repository, transport);
    }

    @Test
    void sendsNewOrderToRecipientsUsingAes128Gcm() throws Exception {
        configured();
        subscription();
        response(201);
        service.deliverNewOrder(orderId, "123", List.of(7L));
        var notification = org.mockito.ArgumentCaptor.forClass(Notification.class);
        verify(transport).send(notification.capture(), eq(Encoding.AES128GCM));
        var payload = new ObjectMapper().readTree(notification.getValue().getPayload());
        assertThat(payload.path("title").asText()).isEqualTo("Новый заказ #123");
        assertThat(payload.path("actionUrl").asText()).isEqualTo("/admin/orders/" + orderId);
        verify(repository).findByUserIdIn(List.of(7L));
        verify(repository, never()).deleteById(any());
    }

    @Test
    void deliversCustomerPayloadOnlyToTheirSubscriptions() throws Exception {
        configured();
        subscription();
        response(201);
        service.deliverCustomerNotification(
                7L, "Статус изменён", "Готов к выдаче", "/orders/" + orderId, "status-" + orderId);
        var notification = org.mockito.ArgumentCaptor.forClass(Notification.class);
        verify(transport).send(notification.capture(), eq(Encoding.AES128GCM));
        var payload = new ObjectMapper().readTree(notification.getValue().getPayload());
        assertThat(payload.path("title").asText()).isEqualTo("Статус изменён");
        assertThat(payload.path("body").asText()).isEqualTo("Готов к выдаче");
        assertThat(payload.path("actionUrl").asText()).isEqualTo("/orders/" + orderId);
        assertThat(payload.path("tag").asText()).isEqualTo("status-" + orderId);
        verify(repository).findByUserIdIn(List.of(7L));
        verifyNoMoreInteractions(repository);
    }

    @Test
    void removesExpiredSubscription() throws Exception {
        configured();
        subscription();
        response(410);
        service.deliverNewOrder(orderId, "123", List.of(7L));
        verify(repository).deleteById(12L);
    }

    @Test
    void retainsSubscriptionOnProviderRejection() throws Exception {
        configured();
        subscription();
        response(403);
        service.deliverNewOrder(orderId, "123", List.of(7L));
        verify(repository, never()).deleteById(any());
    }

    @Test
    void continuesDeliveryAfterTransportFailure() throws Exception {
        configured();
        var first = subscription();
        var second = new WebPushSubscription();
        second.id = 13L;
        second.endpoint = first.endpoint;
        second.p256dh = first.p256dh;
        second.auth = first.auth;
        when(repository.findByUserIdIn(List.of(7L))).thenReturn(List.of(first, second));
        when(transport.send(any(Notification.class), eq(Encoding.AES128GCM)))
                .thenThrow(new java.io.IOException("transport failure"));
        assertThatCode(() -> service.deliverNewOrder(orderId, "123", List.of(7L)))
                .doesNotThrowAnyException();
        verify(transport, times(2)).send(any(Notification.class), eq(Encoding.AES128GCM));
    }

    private void configured() {
        properties.setPublicKey("public-key");
        properties.setPrivateKey("private-key");
        properties.setSubject("https://mstop.kz");
    }

    private WebPushSubscription subscription() {
        WebPushSubscription subscription = new WebPushSubscription();
        subscription.id = 12L;
        subscription.userId = 7L;
        subscription.endpoint = "https://push.example/device";
        subscription.p256dh =
                "BL7ELU24fJTAlH5Kyl8N6BDCac8u8li_U5PIwG963MOvdYs9s7LSzj8x_7v7RFdLZ9Eap50PiiyF5K0TDAis7t0";
        subscription.auth = "juarI8x__VnHvsOgfeAPHg";
        when(repository.findByUserIdIn(List.of(7L))).thenReturn(List.of(subscription));
        return subscription;
    }

    private void response(int code) throws Exception {
        HttpResponse response = mock(HttpResponse.class);
        StatusLine status = mock(StatusLine.class);
        when(response.getStatusLine()).thenReturn(status);
        when(status.getStatusCode()).thenReturn(code);
        when(transport.send(any(Notification.class), eq(Encoding.AES128GCM))).thenReturn(response);
    }
}
