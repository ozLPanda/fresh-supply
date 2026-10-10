package kz.company.shop.common.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class DesktopRateLimiterTest {
    @Test
    void enforcesIndependentFixedWindowsAndResetsAtExpiry() {
        AtomicLong time = new AtomicLong(1000);
        Clock clock =
                new Clock() {
                    public java.time.ZoneId getZone() {
                        return ZoneOffset.UTC;
                    }

                    public Clock withZone(java.time.ZoneId zone) {
                        return this;
                    }

                    public Instant instant() {
                        return Instant.ofEpochMilli(time.get());
                    }
                };
        var limiter = new DesktopRateLimiter(clock);
        var window = Duration.ofSeconds(10);
        assertThat(limiter.exceeded("login:a", 2, window)).isFalse();
        assertThat(limiter.exceeded("login:a", 2, window)).isFalse();
        assertThat(limiter.exceeded("login:a", 2, window)).isTrue();
        assertThat(limiter.exceeded("login:b", 2, window)).isFalse();
        time.set(11000);
        assertThat(limiter.exceeded("login:a", 2, window)).isFalse();
    }

    @Test
    void concurrentRequestsCannotEvadeLimit() {
        var limiter = new DesktopRateLimiter();
        long allowed =
                java.util.stream.IntStream.range(0, 1000)
                        .parallel()
                        .filter(n -> !limiter.exceeded("same", 20, Duration.ofMinutes(1)))
                        .count();
        assertThat(allowed).isEqualTo(20);
    }
}
