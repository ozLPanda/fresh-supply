package kz.company.shop.reviews.repository;

import kz.company.shop.reviews.entity.ReviewMessage;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewMessageRepository extends JpaRepository<ReviewMessage, Long> {}
