package kz.company.shop.priceStatistics.repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import kz.company.shop.priceStatistics.entity.PriceChangeSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PriceChangeSnapshotRepository extends JpaRepository<PriceChangeSnapshot, Long> {
    List<PriceChangeSnapshot> findByStatisticsImportId(Long statisticsImportId);

    List<PriceChangeSnapshot> findByStatisticsImportIdIn(
            java.util.Collection<Long> statisticsImportIds);

    @Query(
            "select i.completedAt as changedAt, s.oldPrice as oldPrice, s.newPrice as newPrice, "
                    + "s.changePercent as changePercent "
                    + "from PriceChangeSnapshot s, PriceStatisticsImport i "
                    + "where s.statisticsImportId = i.id "
                    + "and s.productId = :productId "
                    + "and s.priceType = kz.company.shop.priceStatistics.entity.PriceType.RETAIL "
                    + "order by i.completedAt asc, s.id asc")
    List<ProductPriceHistoryProjection> findRetailHistoryByProductId(
            @Param("productId") Long productId);

    @Query(
            "select i.completedAt as changedAt, s.oldPrice as oldPrice, s.newPrice as newPrice, "
                    + "s.changePercent as changePercent "
                    + "from PriceChangeSnapshot s, PriceStatisticsImport i "
                    + "where s.statisticsImportId = i.id "
                    + "and s.productId = :productId "
                    + "and s.priceType = kz.company.shop.priceStatistics.entity.PriceType.RETAIL "
                    + "and i.completedAt >= :from "
                    + "order by i.completedAt asc, s.id asc")
    List<ProductPriceHistoryProjection> findRetailHistoryByProductIdSince(
            @Param("productId") Long productId, @Param("from") Instant from);

    /**
     * The latest incoming cost known on or before the end of a business day. The caller
     * deliberately uses the next day as an exclusive boundary: an import made at any time on the
     * order date is effective for that whole date.
     */
    @Query(
            "select s.newPrice "
                    + "from PriceChangeSnapshot s, PriceStatisticsImport i "
                    + "where s.statisticsImportId = i.id "
                    + "and s.productId = :productId "
                    + "and s.priceType = kz.company.shop.priceStatistics.entity.PriceType.INCOMING "
                    + "and i.completedAt < :endExclusive "
                    + "order by i.completedAt desc, s.id desc")
    List<BigDecimal> findIncomingPricesEffectiveBefore(
            @Param("productId") Long productId, @Param("endExclusive") Instant endExclusive);

    /**
     * When an order predates the first recorded import, that import's old value is the cost that
     * was effective before the import date.
     */
    @Query(
            "select s.oldPrice "
                    + "from PriceChangeSnapshot s, PriceStatisticsImport i "
                    + "where s.statisticsImportId = i.id "
                    + "and s.productId = :productId "
                    + "and s.priceType = kz.company.shop.priceStatistics.entity.PriceType.INCOMING "
                    + "and i.completedAt >= :endExclusive "
                    + "order by i.completedAt asc, s.id asc")
    List<BigDecimal> findIncomingPricesStartingAt(
            @Param("productId") Long productId, @Param("endExclusive") Instant endExclusive);

    @Query(
            "select s.newPrice from PriceChangeSnapshot s, PriceStatisticsImport i "
                    + "where s.statisticsImportId = i.id and s.productId = :productId "
                    + "and s.priceType = :priceType and i.completedAt < :endExclusive "
                    + "order by i.completedAt desc, s.id desc")
    List<BigDecimal> findPricesEffectiveBefore(
            @Param("productId") Long productId,
            @Param("priceType") kz.company.shop.priceStatistics.entity.PriceType priceType,
            @Param("endExclusive") Instant endExclusive);

    @Query(
            "select s.oldPrice from PriceChangeSnapshot s, PriceStatisticsImport i "
                    + "where s.statisticsImportId = i.id and s.productId = :productId "
                    + "and s.priceType = :priceType and i.completedAt >= :endExclusive "
                    + "order by i.completedAt asc, s.id asc")
    List<BigDecimal> findPricesStartingAt(
            @Param("productId") Long productId,
            @Param("priceType") kz.company.shop.priceStatistics.entity.PriceType priceType,
            @Param("endExclusive") Instant endExclusive);

    interface ProductPriceHistoryProjection {
        Instant getChangedAt();

        BigDecimal getOldPrice();

        BigDecimal getNewPrice();

        BigDecimal getChangePercent();
    }
}
