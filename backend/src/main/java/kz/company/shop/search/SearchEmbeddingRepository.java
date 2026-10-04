package kz.company.shop.search;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import kz.company.shop.products.dto.ProductListParams;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SearchEmbeddingRepository {
    private final JdbcTemplate jdbcTemplate;

    public SearchEmbeddingRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<String> productHash(Long productId, String model) {
        return hash(
                "select content_hash from product_search_embeddings where product_id = ? and model = ?",
                productId,
                model);
    }

    public Optional<String> categoryHash(Long categoryId, String model) {
        return hash(
                "select content_hash from category_search_embeddings where category_id = ? and model = ?",
                categoryId,
                model);
    }

    public void upsertProduct(
            Long productId, String model, String contentHash, List<Float> vector) {
        jdbcTemplate.update(
                """
                insert into product_search_embeddings (product_id, model, content_hash, embedding, updated_at)
                values (?, ?, ?, ?::vector, now())
                on conflict (product_id) do update set
                    model = excluded.model,
                    content_hash = excluded.content_hash,
                    embedding = excluded.embedding,
                    updated_at = now()
                """,
                productId,
                model,
                contentHash,
                toVectorLiteral(vector));
    }

    public void upsertCategory(
            Long categoryId, String model, String contentHash, List<Float> vector) {
        jdbcTemplate.update(
                """
                insert into category_search_embeddings (category_id, model, content_hash, embedding, updated_at)
                values (?, ?, ?, ?::vector, now())
                on conflict (category_id) do update set
                    model = excluded.model,
                    content_hash = excluded.content_hash,
                    embedding = excluded.embedding,
                    updated_at = now()
                """,
                categoryId,
                model,
                contentHash,
                toVectorLiteral(vector));
    }

    public long countSemanticProducts(
            ProductListParams params, String model, List<Float> queryVector, double maxDistance) {
        QueryParts query = productFilterQuery(params, model, queryVector, maxDistance, true);
        return jdbcTemplate.queryForObject(
                query.sql().toString(), Long.class, query.args().toArray());
    }

    public List<ProductSearchRow> searchProducts(
            ProductListParams params,
            String model,
            List<Float> queryVector,
            double maxDistance,
            int limit,
            int offset) {
        QueryParts query = productFilterQuery(params, model, queryVector, maxDistance, false);
        query.args().add(limit);
        query.args().add(offset);
        return jdbcTemplate.query(
                query.sql().toString(), this::mapProductSearchRow, query.args().toArray());
    }

    public List<Long> searchProductsByNameTerms(
            ProductListParams params, List<String> terms, int limit) {
        if (terms.isEmpty()) return List.of();
        QueryParts query = new QueryParts();
        query.sql()
                .append(
                        """
                        select p.id
                        from products p
                        left join categories c on c.id = p.category_id
                        where p.deleted_at is null
                        """);
        applyFilters(query, params);
        query.sql().append(" and (");
        for (int index = 0; index < terms.size(); index++) {
            if (index > 0) query.sql().append(" or ");
            query.sql().append("replace(lower(p.name_ru), 'ё', 'е') like ?");
            query.args().add("%" + terms.get(index).toLowerCase().replace('ё', 'е') + "%");
        }
        query.sql().append(" ) order by p.active desc, p.created_at desc, p.id asc limit ?");
        query.args().add(limit);
        return jdbcTemplate.queryForList(
                query.sql().toString(), Long.class, query.args().toArray());
    }

    private Optional<String> hash(String sql, Long entityId, String model) {
        return jdbcTemplate.query(
                sql,
                rs -> rs.next() ? Optional.of(rs.getString(1)) : Optional.empty(),
                entityId,
                model);
    }

    private QueryParts productFilterQuery(
            ProductListParams params,
            String model,
            List<Float> queryVector,
            double maxDistance,
            boolean countOnly) {
        QueryParts query = new QueryParts();
        if (countOnly) {
            query.sql()
                    .append(
                            """
                    select count(*)
                    from products p
                    join product_search_embeddings pse on pse.product_id = p.id and pse.model = ?
                    left join categories c on c.id = p.category_id
                    where p.deleted_at is null
                    """);
            query.args().add(model);
        } else {
            query.sql()
                    .append(
                            """
                    select
                        p.id,
                        (pse.embedding <=> ?::vector) as distance,
                        case
                            when replace(lower(concat_ws(' ', p.sku, p.name_ru, p.name_kk, p.short_description_ru, p.short_description_kk, p.description_ru, p.description_kk, c.name_ru, c.name_kk)), 'ё', 'е') like ?
                            then 1
                            else 0
                        end as lexical_rank
                    from products p
                    join product_search_embeddings pse on pse.product_id = p.id and pse.model = ?
                    left join categories c on c.id = p.category_id
                    where p.deleted_at is null
                    """);
            query.args().add(toVectorLiteral(queryVector));
            query.args().add("%" + normalizeSearch(params.search()) + "%");
            query.args().add(model);
        }

        applyFilters(query, params);

        if (queryVector != null) {
            query.sql().append("\n and (pse.embedding <=> ?::vector) <= ?\n");
            query.args().add(toVectorLiteral(queryVector));
            query.args().add(maxDistance);
        }

        if (!countOnly) {
            query.sql()
                    .append(
                            """
                    order by lexical_rank desc, distance asc, p.active desc, p.created_at desc, lower(p.name_ru) asc
                    limit ? offset ?
                    """);
        }
        return query;
    }

    private void applyFilters(QueryParts query, ProductListParams params) {
        if (params.category() != null && !params.category().isBlank()) {
            String category = params.category().trim();
            try {
                Long categoryId = Long.parseLong(category);
                query.sql().append(" and p.category_id = ?");
                query.args().add(categoryId);
            } catch (NumberFormatException ignored) {
                query.sql().append(" and lower(c.slug) = lower(?)");
                query.args().add(category);
            }
        }
        addPriceFilter(query, " and p.price >= ?", params.minPrice());
        addPriceFilter(query, " and p.price <= ?", params.maxPrice());
        if (Boolean.TRUE.equals(params.inStock())) {
            query.sql().append(" and p.active = true");
        }
        if (params.active() != null) {
            query.sql().append(" and p.active = ?");
            query.args().add(params.active());
        }
        if (Boolean.TRUE.equals(params.excludeImportCreated())) {
            query.sql().append(" and (p.created_from_price_import_id is null or p.active = true)");
        }
    }

    private void addPriceFilter(QueryParts query, String sql, BigDecimal value) {
        if (value == null) return;
        query.sql().append(sql);
        query.args().add(value);
    }

    private String normalizeSearch(String value) {
        return value == null ? "" : value.trim().toLowerCase().replace('ё', 'е');
    }

    private ProductSearchRow mapProductSearchRow(ResultSet rs, int rowNum) throws SQLException {
        return new ProductSearchRow(rs.getLong("id"), rs.getDouble("distance"));
    }

    private String toVectorLiteral(List<Float> vector) {
        StringBuilder builder = new StringBuilder("[");
        for (int i = 0; i < vector.size(); i++) {
            if (i > 0) builder.append(',');
            builder.append(vector.get(i));
        }
        return builder.append(']').toString();
    }

    public record ProductSearchRow(Long productId, double distance) {}

    private record QueryParts(StringBuilder sql, List<Object> args) {
        private QueryParts() {
            this(new StringBuilder(), new java.util.ArrayList<>());
        }
    }
}
