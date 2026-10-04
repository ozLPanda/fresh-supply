package kz.company.shop.seo.controller;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** Keeps indexed Satu product URLs pointing to their verified current product. */
@RestController
public class LegacyProductRedirectController {
    private static final Logger log =
            LoggerFactory.getLogger(LegacyProductRedirectController.class);
    private final JdbcTemplate jdbc;

    public LegacyProductRedirectController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping({"/p{legacyId:[0-9]+}-{slug}.html", "/p{legacyId:[0-9]+}.html"})
    public ResponseEntity<Void> redirect(@PathVariable("legacyId") String legacyId) {
        try {
            List<Long> ids =
                    jdbc.queryForList(
                            """
                            select p.id
                            from legacy_product_urls legacy
                            join products p on p.id = legacy.product_id
                            where legacy.legacy_id = ?
                              and p.active = true
                              and p.deleted_at is null
                            """,
                            Long.class,
                            legacyId);
            if (ids.isEmpty()) return error(404);
            return ResponseEntity.status(301)
                    .header("Location", "/product/" + ids.getFirst())
                    .cacheControl(CacheControl.noStore())
                    .build();
        } catch (RuntimeException e) {
            log.warn("Unable to resolve legacy product URL", e);
            return error(503);
        }
    }

    private ResponseEntity<Void> error(int status) {
        return ResponseEntity.status(status)
                .header("X-Robots-Tag", "noindex")
                .cacheControl(CacheControl.noStore())
                .build();
    }
}
