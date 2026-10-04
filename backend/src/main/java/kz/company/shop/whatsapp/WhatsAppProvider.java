package kz.company.shop.whatsapp;

import java.util.List;

/** Boundary to the WhatsApp transport. Future sending or bot capabilities belong here. */
public interface WhatsAppProvider {
    boolean acceptsVerification(String mode, String token);

    void verifySignature(byte[] payload, String signature);

    List<IncomingWhatsAppMessage> incomingMessages(byte[] payload);
}
