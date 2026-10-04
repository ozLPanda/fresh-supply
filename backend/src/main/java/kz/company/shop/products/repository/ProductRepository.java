package kz.company.shop.products.repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import kz.company.shop.products.entity.Product;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

public interface ProductRepository
        extends JpaRepository<Product, Long>,
                JpaSpecificationExecutor<Product>,
                ProductPriceAnalyticsRepository {
    List<Product> findByDeletedAtIsNullOrderByCreatedAtDesc();

    List<Product> findByDeletedAtIsNullOrderByCreatedAtDesc(Pageable pageable);

    List<Product> findByDeletedAtIsNullOrderByCreatedAtDescIdDesc(Pageable pageable);

    Optional<Product> findByIdAndDeletedAtIsNull(Long id);

    boolean existsByIdAndDeletedAtIsNull(Long id);

    Optional<Product> findBySkuAndDeletedAtIsNull(String sku);

    List<Product> findBySkuInAndDeletedAtIsNull(Set<String> skus);

    List<Product> findByDeletedAtIsNullOrderByNameRuAsc();

    @Query(
            value =
                    "select p.category_id, coalesce(c.name_ru, 'Без категории'), count(p.id), "
                            + "count(case when p.incoming_price > 0 and p.price is not null then 1 end), "
                            + "avg(case when p.incoming_price > 0 and p.price is not null then (p.price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "min(case when p.incoming_price > 0 and p.price is not null then (p.price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "max(case when p.incoming_price > 0 and p.price is not null then (p.price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "count(case when p.incoming_price > 0 and p.wholesale_price is not null then 1 end), "
                            + "avg(case when p.incoming_price > 0 and p.wholesale_price is not null then (p.wholesale_price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "min(case when p.incoming_price > 0 and p.wholesale_price is not null then (p.wholesale_price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "max(case when p.incoming_price > 0 and p.wholesale_price is not null then (p.wholesale_price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "count(case when p.incoming_price > 0 and p.bulk_wholesale_price is not null then 1 end), "
                            + "avg(case when p.incoming_price > 0 and p.bulk_wholesale_price is not null then (p.bulk_wholesale_price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "min(case when p.incoming_price > 0 and p.bulk_wholesale_price is not null then (p.bulk_wholesale_price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "max(case when p.incoming_price > 0 and p.bulk_wholesale_price is not null then (p.bulk_wholesale_price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "count(case when p.incoming_price > 0 and p.sko_price is not null then 1 end), "
                            + "avg(case when p.incoming_price > 0 and p.sko_price is not null then (p.sko_price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "min(case when p.incoming_price > 0 and p.sko_price is not null then (p.sko_price - p.incoming_price) * 100 / p.incoming_price end), "
                            + "max(case when p.incoming_price > 0 and p.sko_price is not null then (p.sko_price - p.incoming_price) * 100 / p.incoming_price end) "
                            + "from products p left join categories c on c.id = p.category_id "
                            + "where p.deleted_at is null group by p.category_id, c.name_ru "
                            + "order by coalesce(c.name_ru, 'Без категории')",
            nativeQuery = true)
    List<Object[]> priceAnalyticsByCategory();

    List<Product> findByIdInAndDeletedAtIsNull(Set<Long> ids);

    boolean existsBySku(String sku);

    long countByActiveTrueAndDeletedAtIsNull();

    List<Product> findByActiveTrueAndDeletedAtIsNullOrderByUpdatedAtDesc();

    @Query(
            "select product from Product product "
                    + "where product.createdFromPriceImportId is not null "
                    + "and product.active = false and product.deletedAt is null "
                    + "order by product.createdAt desc, product.id desc")
    List<Product> findImportCreatedDrafts();

    @Query(
            value =
                    "select count(*) from products p "
                            + "where p.active = true and p.deleted_at is null "
                            + "and not exists (select 1 from product_images pi where pi.product_id = p.id)",
            nativeQuery = true)
    long countActiveWithoutImages();

    @Query(
            "select p.categoryId as categoryId, count(p.id) as total "
                    + "from Product p where p.active = true and p.deletedAt is null and p.categoryId is not null "
                    + "group by p.categoryId")
    List<Object[]> countByCategoryId();
}
