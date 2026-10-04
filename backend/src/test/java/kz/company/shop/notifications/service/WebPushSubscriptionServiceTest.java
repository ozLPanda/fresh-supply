package kz.company.shop.notifications.service;

import static org.mockito.Mockito.*;

import kz.company.shop.notifications.dto.PushSubscriptionRequest;
import kz.company.shop.notifications.repository.WebPushSubscriptionRepository;
import org.junit.jupiter.api.Test;

class WebPushSubscriptionServiceTest {
    @Test
    void deleteScopesEndpointToAuthenticatedOwner() {
        WebPushSubscriptionRepository repository = mock(WebPushSubscriptionRepository.class);
        var request =
                new PushSubscriptionRequest(
                        "https://push.example/device",
                        new PushSubscriptionRequest.Keys("key", "auth"));
        new WebPushSubscriptionService(repository).delete(7L, request);
        verify(repository).deleteByUserIdAndEndpoint(7L, request.endpoint());
        verifyNoMoreInteractions(repository);
    }
}
