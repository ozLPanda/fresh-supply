package kz.company.shop.products.repository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.TypedQuery;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import kz.company.shop.categories.entity.Category;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto.PriceType;
import kz.company.shop.products.dto.ProductPriceAnalyticsFilter;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Repository;

@Repository
class ProductPriceAnalyticsRepositoryImpl implements ProductPriceAnalyticsRepository {
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    @PersistenceContext private EntityManager entityManager;

    @Override
    public Page<Product> findPriceAnalytics(
            String search, Long categoryId, ProductPriceAnalyticsFilter filter, Pageable pageable) {
        CriteriaBuilder builder = entityManager.getCriteriaBuilder();
        CriteriaQuery<Product> query = builder.createQuery(Product.class);
        Root<Product> product = query.from(Product.class);
        Join<Product, Category> category = product.join("category", JoinType.LEFT);
        List<Predicate> predicates =
                predicates(builder, product, category, search, categoryId, filter);

        Path<BigDecimal> incomingPrice = product.get("incomingPrice");
        Predicate hasPriceBelowIncoming =
                builder.or(
                        priceBelowIncoming(builder, product, "price"),
                        priceBelowIncoming(builder, product, "wholesalePrice"),
                        priceBelowIncoming(builder, product, "bulkWholesalePrice"),
                        priceBelowIncoming(builder, product, "skoPrice"));
        Expression<Integer> problemOrder =
                builder.<Integer>selectCase()
                        .when(
                                builder.and(
                                        builder.isNotNull(incomingPrice), hasPriceBelowIncoming),
                                0)
                        .otherwise(1);
        Expression<Integer> missingIncomingOrder =
                builder.<Integer>selectCase().when(builder.isNull(incomingPrice), 1).otherwise(0);
        query.where(predicates.toArray(Predicate[]::new))
                .orderBy(
                        builder.asc(problemOrder),
                        builder.asc(missingIncomingOrder),
                        builder.asc(builder.lower(product.get("nameRu"))),
                        builder.asc(product.get("id")));

        TypedQuery<Product> typedQuery = entityManager.createQuery(query);
        typedQuery.setFirstResult((int) pageable.getOffset());
        typedQuery.setMaxResults(pageable.getPageSize());
        List<Product> items = typedQuery.getResultList();

        CriteriaQuery<Long> countQuery = builder.createQuery(Long.class);
        Root<Product> countProduct = countQuery.from(Product.class);
        Join<Product, Category> countCategory = countProduct.join("category", JoinType.LEFT);
        countQuery
                .select(builder.count(countProduct))
                .where(
                        predicates(builder, countProduct, countCategory, search, categoryId, filter)
                                .toArray(Predicate[]::new));
        long totalItems = entityManager.createQuery(countQuery).getSingleResult();
        return new PageImpl<>(items, pageable, totalItems);
    }

    private List<Predicate> predicates(
            CriteriaBuilder builder,
            Root<Product> product,
            Join<Product, Category> category,
            String search,
            Long categoryId,
            ProductPriceAnalyticsFilter filter) {
        List<Predicate> result = new ArrayList<>();
        result.add(builder.isNull(product.get("deletedAt")));
        if (categoryId != null) result.add(builder.equal(product.get("categoryId"), categoryId));
        List<String> searchVariants = ProductSearchTextNormalizer.rawSearchVariants(search);
        if (!searchVariants.isEmpty()) {
            List<Predicate> matches = new ArrayList<>();
            for (String variant : searchVariants) {
                String pattern = "%" + variant + "%";
                matches.add(
                        builder.or(
                                builder.like(builder.lower(product.get("sku")), pattern),
                                builder.like(builder.lower(product.get("nameRu")), pattern),
                                builder.like(builder.lower(product.get("nameKk")), pattern),
                                builder.like(
                                        builder.lower(builder.coalesce(category.get("nameRu"), "")),
                                        pattern)));
            }
            result.add(builder.or(matches.toArray(Predicate[]::new)));
        }
        if (filter.hasPercentRange()) result.add(matchesPercentRange(builder, product, filter));
        return result;
    }

    private Predicate matchesPercentRange(
            CriteriaBuilder builder, Root<Product> product, ProductPriceAnalyticsFilter filter) {
        List<Predicate> selectedTypes = new ArrayList<>();
        for (PriceType type : filter.priceTypes()) {
            selectedTypes.add(matchesPercentRange(builder, product, priceField(type), filter));
        }
        return filter.matchAllPriceTypes()
                ? builder.and(selectedTypes.toArray(Predicate[]::new))
                : builder.or(selectedTypes.toArray(Predicate[]::new));
    }

    private Predicate matchesPercentRange(
            CriteriaBuilder builder,
            Root<Product> product,
            String priceField,
            ProductPriceAnalyticsFilter filter) {
        Path<BigDecimal> price = product.get(priceField);
        Path<BigDecimal> incomingPrice = product.get("incomingPrice");
        List<Predicate> conditions = new ArrayList<>();
        conditions.add(builder.isNotNull(price));
        conditions.add(builder.isNotNull(incomingPrice));
        conditions.add(builder.greaterThan(incomingPrice, BigDecimal.ZERO));
        if (filter.minMarkupPercent() != null) {
            conditions.add(
                    builder.greaterThanOrEqualTo(
                            builder.prod(price, HUNDRED),
                            builder.prod(incomingPrice, HUNDRED.add(filter.minMarkupPercent()))));
        }
        if (filter.maxMarkupPercent() != null) {
            conditions.add(
                    builder.lessThanOrEqualTo(
                            builder.prod(price, HUNDRED),
                            builder.prod(incomingPrice, HUNDRED.add(filter.maxMarkupPercent()))));
        }
        return builder.and(conditions.toArray(Predicate[]::new));
    }

    private Predicate priceBelowIncoming(
            CriteriaBuilder builder, Root<Product> product, String priceField) {
        return builder.lessThan(product.get(priceField), product.get("incomingPrice"));
    }

    private String priceField(PriceType type) {
        return switch (type) {
            case RETAIL -> "price";
            case WHOLESALE -> "wholesalePrice";
            case BULK_WHOLESALE -> "bulkWholesalePrice";
            case SKO -> "skoPrice";
        };
    }
}
