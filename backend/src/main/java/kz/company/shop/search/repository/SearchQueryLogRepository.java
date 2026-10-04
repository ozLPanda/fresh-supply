package kz.company.shop.search.repository;

import kz.company.shop.search.entity.SearchQueryLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SearchQueryLogRepository extends JpaRepository<SearchQueryLog, Long> {}
