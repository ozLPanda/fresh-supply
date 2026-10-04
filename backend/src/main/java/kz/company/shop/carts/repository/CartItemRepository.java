package kz.company.shop.carts.repository;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import kz.company.shop.carts.entity.CartItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CartItemRepository extends JpaRepository<CartItem, Long> {
    List<CartItem> findByUserIdOrderByCreatedAtAsc(Long userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select item from CartItem item where item.userId = :userId and item.id in :itemIds order by item.createdAt asc")
    List<CartItem> findByUserIdAndIdInForUpdate(
            @Param("userId") Long userId, @Param("itemIds") List<Long> itemIds);

    Optional<CartItem> findByUserIdAndProductId(Long userId, Long productId);

    void deleteByUserIdAndProductId(Long userId, Long productId);

    void deleteByUserId(Long userId);

    void deleteByUserIdAndIdIn(Long userId, List<Long> itemIds);
}
