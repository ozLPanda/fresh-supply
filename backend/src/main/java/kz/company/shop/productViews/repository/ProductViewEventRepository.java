package kz.company.shop.productViews.repository;

import java.time.Instant;
import java.util.List;
import kz.company.shop.productViews.dto.ProductViewAnalyticsProjection;
import kz.company.shop.productViews.entity.ProductViewEvent;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProductViewEventRepository extends JpaRepository<ProductViewEvent, Long> {
    boolean existsByProductIdAndVisitorKeyAndViewedAtAfter(
            Long productId, String visitorKey, Instant viewedAt);

    long countByViewedAtGreaterThanEqualAndViewedAtLessThan(Instant from, Instant to);

    @Query(
            value =
                    "select p.id as productId, p.sku as sku, p.nameRu as nameRu, "
                            + "c.nameRu as categoryNameRu, count(event.id) as views "
                            + "from ProductViewEvent event "
                            + "join Product p on p.id = event.productId "
                            + "left join p.category c "
                            + "where p.deletedAt is null "
                            + "and (:search = '' or lower(p.nameRu) like lower(concat('%', :search, '%')) "
                            + "or lower(p.sku) like lower(concat('%', :search, '%'))) "
                            + "group by p.id, p.sku, p.nameRu, c.nameRu",
            countQuery =
                    "select count(distinct event.productId) from ProductViewEvent event "
                            + "join Product p on p.id = event.productId "
                            + "where p.deletedAt is null "
                            + "and (:search = '' or lower(p.nameRu) like lower(concat('%', :search, '%')) "
                            + "or lower(p.sku) like lower(concat('%', :search, '%'))) ")
    Page<ProductViewAnalyticsProjection> findProductViewAnalytics(
            @Param("search") String search, Pageable pageable);

    @Query(
            value =
                    "select to_char(timezone('Asia/Qyzylorda', viewed_at), 'YYYY-MM-DD'), count(*) "
                            + "from product_view_events where product_id = :productId "
                            + "group by 1 order by 1",
            nativeQuery = true)
    List<Object[]> historyByDay(@Param("productId") Long productId);

    @Query(
            value =
                    "select to_char(timezone('Asia/Qyzylorda', viewed_at), 'YYYY-MM'), count(*) "
                            + "from product_view_events where product_id = :productId "
                            + "group by 1 order by 1",
            nativeQuery = true)
    List<Object[]> historyByMonth(@Param("productId") Long productId);

    @Query(
            value =
                    "select to_char(timezone('Asia/Qyzylorda', viewed_at), 'YYYY'), count(*) "
                            + "from product_view_events where product_id = :productId "
                            + "group by 1 order by 1",
            nativeQuery = true)
    List<Object[]> historyByYear(@Param("productId") Long productId);
}
