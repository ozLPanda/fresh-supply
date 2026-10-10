package kz.company.shop.common.security;

import java.time.Duration;

interface RateLimiter {
    boolean exceeded(String key, int limit, Duration window);
}
