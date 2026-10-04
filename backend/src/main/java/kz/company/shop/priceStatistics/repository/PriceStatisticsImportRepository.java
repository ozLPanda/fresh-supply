package kz.company.shop.priceStatistics.repository;

import java.util.Optional;
import java.util.UUID;
import kz.company.shop.priceStatistics.entity.PriceStatisticsImport;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PriceStatisticsImportRepository
        extends JpaRepository<PriceStatisticsImport, Long> {
    boolean existsByImportSessionId(UUID importSessionId);

    Optional<PriceStatisticsImport> findByImportSessionId(UUID importSessionId);

    java.util.List<PriceStatisticsImport> findAllByOrderByCompletedAtAsc();
}
