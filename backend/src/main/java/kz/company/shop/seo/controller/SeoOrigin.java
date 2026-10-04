package kz.company.shop.seo.controller;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** One canonical storefront origin for HTML, sitemap and crawler directives. */
@Component
public class SeoOrigin {
    private final String siteUrl;

    public SeoOrigin(@Value("${app.seo.site-url:}") String siteUrl) {
        this.siteUrl = siteUrl;
    }

    public String resolve(HttpServletRequest request) {
        if (siteUrl != null && !siteUrl.isBlank()) {
            URI configured = URI.create(siteUrl.trim());
            if (configured.getHost() == null
                    || configured.getUserInfo() != null
                    || !("https".equals(configured.getScheme())
                            || "http".equals(configured.getScheme()))
                    || configured.getQuery() != null
                    || configured.getFragment() != null
                    || !(configured.getPath().isEmpty() || "/".equals(configured.getPath()))) {
                throw new IllegalStateException(
                        "app.seo.site-url must be an HTTP(S) origin without a path");
            }
            return configured.getScheme() + "://" + configured.getRawAuthority();
        }
        String host = firstHeaderValue(request.getHeader("X-Forwarded-Host"));
        if (host == null) host = request.getHeader("Host");
        if (host == null || !host.matches("[A-Za-z0-9.:-]+")) host = "localhost";
        String scheme = firstHeaderValue(request.getHeader("X-Forwarded-Proto"));
        if (scheme == null || !scheme.matches("https?")) scheme = request.getScheme();
        return scheme + "://" + host;
    }

    private String firstHeaderValue(String value) {
        if (value == null || value.isBlank()) return null;
        return value.split(",", 2)[0].trim();
    }
}
