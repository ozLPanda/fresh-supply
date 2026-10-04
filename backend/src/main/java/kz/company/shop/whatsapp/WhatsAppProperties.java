package kz.company.shop.whatsapp;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.whatsapp")
public record WhatsAppProperties(
        String accessToken,
        String phoneNumberId,
        String wabaId,
        String verifyToken,
        String appSecret) {
    public boolean isWebhookConfigured() {
        return hasValue(phoneNumberId) && hasValue(verifyToken) && hasValue(appSecret);
    }

    private static boolean hasValue(String value) {
        return value != null && !value.isBlank();
    }
}
