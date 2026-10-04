package kz.company.shop.notifications.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record PushSubscriptionRequest(
        @NotBlank String endpoint, @NotNull @Valid Keys keys) {
    public record Keys(
            @NotBlank @JsonProperty("p256dh") String p256dh,
            @NotBlank @JsonProperty("auth") String auth) {}
}
