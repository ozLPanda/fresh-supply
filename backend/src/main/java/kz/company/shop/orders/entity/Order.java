package kz.company.shop.orders.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "orders")
public class Order {
    private static final DateTimeFormatter DISPLAY_DATE = DateTimeFormatter.BASIC_ISO_DATE;
    @Id public UUID id;

    @Column(name = "order_number_date", nullable = false)
    public LocalDate orderNumberDate;

    @Column(name = "daily_number", nullable = false)
    public long dailyNumber;

    @Column(name = "user_id")
    public Long userId;

    @Column(name = "created_by_user_id")
    public Long createdByUserId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public OrderStatus status = OrderStatus.NEW;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_status", nullable = false)
    public PaymentStatus paymentStatus = PaymentStatus.PAID;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_method", nullable = false)
    public PaymentMethod paymentMethod = PaymentMethod.BALANCE;

    @Column(name = "cash_payment_amount", precision = 14, scale = 2)
    public BigDecimal cashPaymentAmount;

    @Column(name = "cashless_payment_amount", precision = 14, scale = 2)
    public BigDecimal cashlessPaymentAmount;

    @Enumerated(EnumType.STRING)
    @Column(name = "cashless_payment_type")
    public CashlessPaymentType cashlessPaymentType;

    @Column(name = "transfer_payment_amount", precision = 14, scale = 2)
    public BigDecimal transferPaymentAmount;

    @Column(name = "card_payment_amount", precision = 14, scale = 2)
    public BigDecimal cardPaymentAmount;

    @Column(name = "qr_payment_amount", precision = 14, scale = 2)
    public BigDecimal qrPaymentAmount;

    @Enumerated(EnumType.STRING)
    @Column(name = "fulfillment_type", nullable = false)
    public FulfillmentType fulfillmentType;

    public String address;

    @Column(name = "contact_phone", nullable = false)
    public String contactPhone;

    @Column(name = "pending_customer_email")
    public String pendingCustomerEmail;

    @Column(name = "pending_customer_phone")
    public String pendingCustomerPhone;

    @Column(columnDefinition = "text")
    public String comment;

    @Column(name = "print_comment", columnDefinition = "text")
    public String printComment;

    @Column(nullable = false)
    public boolean wholesale = false;

    @Enumerated(EnumType.STRING)
    @Column(name = "price_tier", nullable = false)
    public PriceTier priceTier = PriceTier.RETAIL;

    /** The posted price-setting document used for the last document-based price update. */
    @Column(name = "price_source_document_id")
    public UUID priceSourceDocumentId;

    @Column(name = "assembly_assignee_id")
    public Long assemblyAssigneeId;

    @Column(name = "checking_assignee_id")
    public Long checkingAssigneeId;

    @Column(nullable = false, precision = 14, scale = 2)
    public BigDecimal total;

    @Column(name = "paid_total", nullable = false, precision = 14, scale = 2)
    public BigDecimal paidTotal;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC, id ASC")
    public List<OrderItem> items = new ArrayList<>();

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @Column(name = "deleted_at")
    public Instant deletedAt;

    @Column(name = "reservation_expires_at")
    public Instant reservationExpiresAt;

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }

    public String displayCode() {
        return DISPLAY_DATE.format(orderNumberDate) + dailyNumber;
    }
}
