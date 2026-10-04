package kz.company.shop.whatsapp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class MetaCloudWhatsAppProvider implements WhatsAppProvider {
    private final WhatsAppProperties properties;
    private final ObjectMapper objectMapper;

    public MetaCloudWhatsAppProvider(WhatsAppProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean acceptsVerification(String mode, String token) {
        if (!"subscribe".equals(mode) || !hasValue(properties.verifyToken()) || token == null) {
            return false;
        }
        return MessageDigest.isEqual(
                properties.verifyToken().getBytes(StandardCharsets.UTF_8),
                token.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public void verifySignature(byte[] payload, String signature) {
        if (!hasValue(properties.appSecret())) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "WhatsApp webhook is not configured");
        }
        if (signature == null || !signature.startsWith("sha256=")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid WhatsApp signature");
        }
        try {
            byte[] supplied = HexFormat.of().parseHex(signature.substring(7));
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(properties.appSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            if (!MessageDigest.isEqual(mac.doFinal(payload), supplied)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid WhatsApp signature");
            }
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid WhatsApp signature");
        } catch (Exception exception) {
            if (exception instanceof ResponseStatusException responseStatusException) {
                throw responseStatusException;
            }
            throw new IllegalStateException("Unable to verify WhatsApp signature", exception);
        }
    }

    @Override
    public List<IncomingWhatsAppMessage> incomingMessages(byte[] payload) {
        JsonNode root;
        try {
            root = objectMapper.readTree(payload);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid WhatsApp webhook payload");
        }
        if (root == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid WhatsApp webhook payload");
        }
        if (!"whatsapp_business_account".equals(root.path("object").asText())) {
            return List.of();
        }
        List<IncomingWhatsAppMessage> incoming = new ArrayList<>();
        for (JsonNode entry : root.path("entry")) {
            for (JsonNode change : entry.path("changes")) {
                if (!"messages".equals(change.path("field").asText())) continue;
                JsonNode value = change.path("value");
                if (!hasValue(properties.phoneNumberId())
                        || !properties.phoneNumberId().equals(value.path("metadata").path("phone_number_id").asText())) {
                    continue;
                }
                Map<String, String> names = new HashMap<>();
                for (JsonNode contact : value.path("contacts")) {
                    String waId = contact.path("wa_id").asText("");
                    if (!waId.isBlank()) {
                        names.put(waId, nullableText(contact.path("profile").path("name")));
                    }
                }
                for (JsonNode message : value.path("messages")) {
                    String messageId = message.path("id").asText("");
                    String waId = message.path("from").asText("");
                    String timestamp = message.path("timestamp").asText("");
                    if (messageId.isBlank() || waId.isBlank() || messageId.length() > 255 || waId.length() > 64) {
                        continue;
                    }
                    Instant occurredAt;
                    try {
                        occurredAt = Instant.ofEpochSecond(Long.parseLong(timestamp));
                    } catch (NumberFormatException exception) {
                        continue;
                    }
                    String type = message.path("type").asText("unknown");
                    if (type.length() > 40) type = "unknown";
                    String body = messageBody(message, type);
                    String mediaId = nullableText(message.path(type).path("id"));
                    incoming.add(new IncomingWhatsAppMessage(
                            messageId,
                            waId,
                            names.get(waId),
                            type,
                            body,
                            mediaId,
                            occurredAt));
                }
            }
        }
        return incoming;
    }

    private static String messageBody(JsonNode message, String type) {
        return switch (type) {
            case "text" -> nullableText(message.path("text").path("body"));
            case "button" -> nullableText(message.path("button").path("text"));
            case "interactive" -> {
                JsonNode interactive = message.path("interactive");
                String replyType = interactive.path("type").asText("");
                yield nullableText(interactive.path(replyType).path("title"));
            }
            case "image", "video", "document" -> nullableText(message.path(type).path("caption"));
            case "location" -> nullableText(message.path("location").path("name"));
            default -> null;
        };
    }

    private static String nullableText(JsonNode node) {
        String value = node.asText("").trim();
        return value.isBlank() ? null : value;
    }

    private static boolean hasValue(String value) {
        return value != null && !value.isBlank();
    }
}
