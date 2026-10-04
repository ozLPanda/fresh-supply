package kz.company.shop.whatsapp;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/whatsapp/webhook")
public class WhatsAppWebhookController {
    private final WhatsAppProvider provider;
    private final WhatsAppInboxService inbox;

    public WhatsAppWebhookController(WhatsAppProvider provider, WhatsAppInboxService inbox) {
        this.provider = provider;
        this.inbox = inbox;
    }

    @GetMapping(produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> verify(
            @RequestParam(name = "hub.mode", required = false) String mode,
            @RequestParam(name = "hub.verify_token", required = false) String token,
            @RequestParam(name = "hub.challenge", required = false) String challenge) {
        if (challenge == null || !provider.acceptsVerification(mode, token)) {
            return ResponseEntity.status(403).body("Forbidden");
        }
        return ResponseEntity.ok(challenge);
    }

    @PostMapping
    public ResponseEntity<Void> receive(
            @RequestHeader(name = "X-Hub-Signature-256", required = false) String signature,
            @RequestBody byte[] payload) {
        inbox.receive(payload, signature);
        return ResponseEntity.ok().build();
    }
}
