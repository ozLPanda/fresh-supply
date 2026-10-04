package kz.company.shop.orders.service;

import java.security.SecureRandom;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Generates RFC 9562 UUID version 7 values. */
@Component
public class UuidV7Generator {
    private static final SecureRandom RANDOM = new SecureRandom();

    public UUID next() {
        long timestamp = System.currentTimeMillis();
        long mostSignificantBits = (timestamp << 16) | 0x7000L | RANDOM.nextInt(1 << 12);
        long leastSignificantBits = RANDOM.nextLong();
        leastSignificantBits =
                (leastSignificantBits & 0x3fff_ffff_ffff_ffffL) | 0x8000_0000_0000_0000L;
        return new UUID(mostSignificantBits, leastSignificantBits);
    }
}
