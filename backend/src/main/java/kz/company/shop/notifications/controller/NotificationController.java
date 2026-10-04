package kz.company.shop.notifications.controller;

import jakarta.validation.Valid;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.notifications.config.WebPushProperties;
import kz.company.shop.notifications.dto.NotificationDto;
import kz.company.shop.notifications.dto.NotificationListDto;
import kz.company.shop.notifications.dto.PushPublicKeyDto;
import kz.company.shop.notifications.dto.PushSubscriptionRequest;
import kz.company.shop.notifications.service.NotificationService;
import kz.company.shop.notifications.service.WebPushSubscriptionService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService service;
    private final WebPushSubscriptionService pushSubscriptionService;
    private final WebPushProperties webPushProperties;
    private final AuthContext auth;

    public NotificationController(
            NotificationService service,
            WebPushSubscriptionService pushSubscriptionService,
            WebPushProperties webPushProperties,
            AuthContext auth) {
        this.service = service;
        this.pushSubscriptionService = pushSubscriptionService;
        this.webPushProperties = webPushProperties;
        this.auth = auth;
    }

    @GetMapping("/push-public-key")
    public ApiResponse<PushPublicKeyDto> pushPublicKey() {
        auth.current();
        return ApiResponse.ok(
                new PushPublicKeyDto(
                        webPushProperties.isConfigured() ? webPushProperties.getPublicKey() : ""));
    }

    @PostMapping("/push-subscriptions")
    public ApiResponse<Void> savePushSubscription(
            @Valid @RequestBody PushSubscriptionRequest request) {
        pushSubscriptionService.save(auth.current().id(), request);
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/push-subscriptions")
    public ApiResponse<Void> deletePushSubscription(
            @Valid @RequestBody PushSubscriptionRequest request) {
        pushSubscriptionService.delete(auth.current().id(), request);
        return ApiResponse.ok(null);
    }

    @GetMapping
    public ApiResponse<NotificationListDto> list() {
        return ApiResponse.ok(service.list(auth.current().id()));
    }

    @PostMapping("/{id}/read")
    public ApiResponse<NotificationDto> markRead(@PathVariable Long id) {
        return ApiResponse.ok(service.markRead(auth.current().id(), id));
    }

    @PostMapping("/read-all")
    public ApiResponse<Void> markAllRead() {
        service.markAllRead(auth.current().id());
        return ApiResponse.ok(null);
    }
}
