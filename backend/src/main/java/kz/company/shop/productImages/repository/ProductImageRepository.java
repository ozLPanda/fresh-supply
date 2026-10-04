package kz.company.shop.productImages.repository;

import java.util.List;
import java.util.Optional;
import kz.company.shop.productImages.entity.ProductImage;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductImageRepository extends JpaRepository<ProductImage, Long> {
    List<ProductImage> findByProductIdOrderBySortOrderAsc(Long productId);

    Optional<ProductImage> findByIdAndProductId(Long id, Long productId);

    Optional<ProductImage> findFirstByProductIdAndMainImageTrue(Long productId);

    long countByProductId(Long productId);
}
