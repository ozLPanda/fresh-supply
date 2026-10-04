package kz.company.shop.search.entity;

import jakarta.persistence.*;
import java.time.Instant;
import kz.company.shop.search.SearchQuerySource;

@Entity
@Table(
        name = "search_query_logs",
        indexes = {
            @Index(name = "idx_search_query_logs_searched_at", columnList = "searched_at"),
            @Index(name = "idx_search_query_logs_user_id", columnList = "user_id")
        })
public class SearchQueryLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "search_query", nullable = false, length = 500)
    public String query;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    public SearchQuerySource source;

    @Column(name = "category_slug", length = 180)
    public String categorySlug;

    @Column(name = "user_id")
    public Long userId;

    @Column(name = "searched_at", nullable = false)
    public Instant searchedAt;
}
