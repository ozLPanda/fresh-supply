package kz.company.shop.search.service;

import java.time.Instant;
import kz.company.shop.search.SearchQuerySource;
import kz.company.shop.search.entity.SearchQueryLog;
import kz.company.shop.search.repository.SearchQueryLogRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SearchQueryLogService {
    private static final Logger log = LoggerFactory.getLogger(SearchQueryLogService.class);

    private final SearchQueryLogRepository repository;

    public SearchQueryLogService(SearchQueryLogRepository repository) {
        this.repository = repository;
    }

    @Async("searchQueryTaskExecutor")
    @Transactional
    public void record(
            String rawQuery,
            SearchQuerySource source,
            String rawCategorySlug,
            Long userId,
            Instant searchedAt) {
        try {
            String query = normalize(rawQuery, 500);
            if (query == null) return;

            SearchQueryLog entry = new SearchQueryLog();
            entry.query = query;
            entry.source = source;
            entry.categorySlug = normalize(rawCategorySlug, 180);
            entry.userId = userId;
            entry.searchedAt = searchedAt;
            repository.save(entry);
        } catch (Exception exception) {
            log.warn("Could not persist site search query", exception);
        }
    }

    private String normalize(String value, int maxLength) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        return normalized.length() <= maxLength ? normalized : normalized.substring(0, maxLength);
    }
}
