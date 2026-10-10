package kz.company.shop.common.security;

import java.time.Duration;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/** Atomic fixed-window counters shared by every backend instance through Redis. */
@Component
@Profile("!desktop")
final class RedisRateLimiter implements RateLimiter {
    private static final DefaultRedisScript<Long> INCREMENT_WITH_TTL =
            new DefaultRedisScript<>(
                    "local count = redis.call('INCR', KEYS[1]); "
                            + "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; "
                            + "return count;",
                    Long.class);

    private final StringRedisTemplate redis;

    RedisRateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public boolean exceeded(String key, int limit, Duration window) {
        Long count =
                redis.execute(INCREMENT_WITH_TTL, List.of(key), Long.toString(window.toSeconds()));
        return count == null || count > limit;
    }
}
