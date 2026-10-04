package kz.company.shop.categories.repository;

import java.util.Collection;
import java.util.List;
import kz.company.shop.categories.entity.Category;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CategoryRepository
        extends JpaRepository<Category, Long>, JpaSpecificationExecutor<Category> {
    interface NameRuProjection {
        Long getId();

        String getNameRu();
    }

    List<Category> findByDeletedAtIsNullOrderBySortOrderAscNameRuAsc();

    List<Category> findByParentIsNullAndDeletedAtIsNullOrderBySortOrderAscNameRuAsc();

    @Query(
            "select c.id as id, c.nameRu as nameRu from Category c "
                    + "where c.id in :ids and c.deletedAt is null")
    List<NameRuProjection> findNamesRuByIdIn(@Param("ids") Collection<Long> ids);

    boolean existsBySlugAndDeletedAtIsNull(String slug);

    boolean existsBySlugAndDeletedAtIsNullAndIdNot(String slug, Long id);

    long countByActiveTrueAndDeletedAtIsNull();

    List<Category> findByActiveTrueAndDeletedAtIsNullOrderByUpdatedAtDesc();
}
