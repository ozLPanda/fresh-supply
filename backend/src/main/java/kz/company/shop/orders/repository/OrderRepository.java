package kz.company.shop.orders.repository;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentStatus;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.query.Param;

public interface OrderRepository extends JpaRepository<Order, UUID>, JpaSpecificationExecutor<Order> {
    @EntityGraph(attributePaths = "items")
    @Query(
            "select o from Order o where o.userId = :userId and o.deletedAt is null order by o.createdAt desc")
    List<Order> findByUserIdOrderByCreatedAtDesc(@Param("userId") Long userId);

    @Query(
            """
            select count(o)
            from Order o
            where o.status = :status
              and o.deletedAt is null
              and o.createdAt >= :from
              and o.createdAt < :to
            """)
    long countByStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
            @Param("status") OrderStatus status,
            @Param("from") Instant from,
            @Param("to") Instant to);

    @EntityGraph(attributePaths = "items")
    @Query(
            """
            select o
            from Order o
            where o.paymentStatus = :paymentStatus
              and o.deletedAt is null
              and o.createdAt >= :from
              and o.createdAt < :to
            """)
    List<Order> findByPaymentStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
            @Param("paymentStatus") PaymentStatus paymentStatus,
            @Param("from") Instant from,
            @Param("to") Instant to);

    @EntityGraph(attributePaths = "items")
    @Query(
            """
            select o
            from Order o
            where o.paymentStatus = :paymentStatus
              and o.status = :status
              and o.deletedAt is null
              and o.createdAt >= :from
              and o.createdAt < :to
            """)
    List<Order> findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
            @Param("paymentStatus") PaymentStatus paymentStatus,
            @Param("status") OrderStatus status,
            @Param("from") Instant from,
            @Param("to") Instant to);

    @EntityGraph(attributePaths = "items")
    @Query(
            """
            select o
            from Order o
            where o.paymentStatus = :paymentStatus
              and o.status <> :status
              and o.deletedAt is null
              and o.createdAt >= :from
              and o.createdAt < :to
            order by o.createdAt asc
            """)
    List<Order>
            findByPaymentStatusAndStatusNotAndCreatedAtGreaterThanEqualAndCreatedAtLessThanOrderByCreatedAtAsc(
                    @Param("paymentStatus") PaymentStatus paymentStatus,
                    @Param("status") OrderStatus status,
                    @Param("from") Instant from,
                    @Param("to") Instant to);

    @EntityGraph(attributePaths = "items")
    @Query("select o from Order o where o.id = :id and o.deletedAt is null")
    Optional<Order> findWithItemsById(@Param("id") UUID id);

    @EntityGraph(attributePaths = "items")
    @Query(
            """
            select o
            from Order o
            where o.orderNumberDate = :orderDate
              and o.dailyNumber = :dailyNumber
              and o.deletedAt is null
            """)
    Optional<Order> findByOrderNumberDateAndDailyNumber(
            @Param("orderDate") LocalDate orderNumberDate, @Param("dailyNumber") long dailyNumber);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from Order o where o.id = :id and o.deletedAt is null")
    Optional<Order> findForUpdateById(@Param("id") UUID id);

    @Query(
            "select o.id from Order o where o.reservationExpiresAt is not null "
                    + "and o.reservationExpiresAt <= :now and o.deletedAt is null")
    List<UUID> findExpiredReservationIds(@Param("now") Instant now);

    @Override
    @EntityGraph(attributePaths = "items")
    @Query("select o from Order o where o.deletedAt is null")
    List<Order> findAll();

    @Query("select o from Order o where o.id = :id and o.deletedAt is null")
    Optional<Order> findByIdAndDeletedAtIsNull(@Param("id") UUID id);

    @Query(
            """
            select o.id
            from Order o
            join o.items item
            where o.userId = :userId
              and item.productId = :productId
              and o.status <> kz.company.shop.orders.entity.OrderStatus.CANCELLED
              and o.deletedAt is null
            order by o.createdAt desc
            """)
    List<UUID> findReviewEligibleOrderIds(
            @Param("userId") Long userId, @Param("productId") Long productId);

    @Query(
            value =
                    """
                    insert into order_daily_counters (order_number_date, last_daily_number)
                    values (:orderDate, 1)
                    on conflict (order_number_date)
                    do update set last_daily_number = order_daily_counters.last_daily_number + 1
                    returning last_daily_number
                    """,
            nativeQuery = true)
    long nextDailyNumber(@Param("orderDate") LocalDate orderDate);

    @Modifying
    @Query(
            "update Order o set o.userId = :userId "
                    + "where o.userId is null and ((:email is not null and o.pendingCustomerEmail = :email) "
                    + "or (:phone is not null and o.pendingCustomerPhone = :phone)) "
                    + "and o.deletedAt is null")
    int bindPendingCustomerOrders(
            @Param("userId") Long userId,
            @Param("email") String email,
            @Param("phone") String phone);
}
