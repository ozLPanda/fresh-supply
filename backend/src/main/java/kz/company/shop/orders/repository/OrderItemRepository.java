package kz.company.shop.orders.repository;

import java.util.List;
import kz.company.shop.orders.entity.OrderItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface OrderItemRepository extends JpaRepository<OrderItem, Long> {
    @Query(
            """
            select item
            from OrderItem item
            join fetch item.order order
            where order.deletedAt is null
              and item.stockShortageQuantity > 0
            order by item.stockShortageReleasedAt desc, item.id desc
            """)
    List<OrderItem> findStockShortageReleases();
}
