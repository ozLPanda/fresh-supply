package kz.company.shop.reviews.repository;

import java.util.Optional;
import kz.company.shop.reviews.entity.Review;
import kz.company.shop.reviews.entity.ReviewStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewRepository extends JpaRepository<Review, Long> {
    Page<Review> findByProductIdAndStatusOrderByCreatedAtDesc(
            Long productId, ReviewStatus status, Pageable pageable);

    Page<Review> findByStatusOrderByCreatedAtDesc(ReviewStatus status, Pageable pageable);

    Page<Review> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Optional<Review> findById(Long id);

    long countByStatus(ReviewStatus status);

    long countByStatusAndVerified(ReviewStatus status, boolean verified);

    long countByStatusAndProductId(ReviewStatus status, Long productId);

    long countByStatusAndProductIdAndVerified(
            ReviewStatus status, Long productId, boolean verified);

    @Query(
            "select coalesce(avg(r.rating), 0) from Review r where r.status = :status and r.productId = :productId")
    double averageForProduct(
            @Param("productId") Long productId, @Param("status") ReviewStatus status);

    @Query("select coalesce(avg(r.rating), 0) from Review r where r.status = :status")
    double averageApproved(@Param("status") ReviewStatus status);
}
