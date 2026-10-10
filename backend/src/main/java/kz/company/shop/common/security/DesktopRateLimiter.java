package kz.company.shop.common.security;

import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** Fixed windows for the single backend process bound to loopback on a desktop. */
@Component
@Profile("desktop")
final class DesktopRateLimiter implements RateLimiter {
    private static final int MAX_KEYS = 10_000;
    private final Map<String, Window> counters = new HashMap<>();
    private final Clock clock;

    DesktopRateLimiter() {
        this(Clock.systemUTC());
    }

    DesktopRateLimiter(Clock clock) {
        this.clock = clock;
    }

    @Override
    public synchronized boolean exceeded(String key, int limit, Duration duration) {
        long now = clock.millis();
        Window current = counters.get(key);
        if (current == null || current.expiresAt() <= now) {
            // Bound memory even if clients forge address headers with many distinct keys.
            if (counters.size() >= MAX_KEYS) {
                counters.entrySet().removeIf(entry -> entry.getValue().expiresAt() <= now);
                if (!counters.containsKey(key) && counters.size() >= MAX_KEYS) return true;
            }
            current = new Window(0, now + duration.toMillis());
        }
        int count = Math.min(current.count() + 1, Math.max(limit, 0) + 1);
        counters.put(key, new Window(count, current.expiresAt()));
        return count > limit;
    }

    private record Window(int count, long expiresAt) {}
}
