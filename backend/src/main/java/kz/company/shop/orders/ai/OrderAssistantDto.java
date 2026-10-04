package kz.company.shop.orders.ai;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import kz.company.shop.orders.dto.BarcodeOrderCreateRequest;
import kz.company.shop.orders.dto.BarcodeOrderProductDto;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.products.entity.MeasurementUnit;

public final class OrderAssistantDto {
    private OrderAssistantDto() {}

    public enum Mode {
        CREATE,
        DRAFT
    }

    public record SeedItem(
            @NotNull Long productId,
            @NotNull BigDecimal quantity,
            MeasurementUnit measurementUnit,
            BigDecimal unitPrice) {}

    public record Start(
            @NotNull Mode mode,
            @NotNull PriceTier priceTier,
            @NotNull @PastOrPresent LocalDate orderDate,
            UUID regularBuyerId,
            Long customerId,
            @Size(max = 180) String pendingCustomerEmail,
            @Size(max = 40) String pendingCustomerPhone,
            @Size(max = 2000) String comment,
            @Size(max = 200) List<@Valid SeedItem> items) {}

    public record Message(
            @Size(max = 20000) String message,
            @Min(0) long revision,
            @Size(max = 160) String answerId,
            UUID regularBuyerId,
            boolean selectBuyer) {
        public Message(String message, long revision) {
            this(message, revision, null, null, false);
        }
    }

    public enum ClarificationKind {
        BUYER,
        CHOICE
    }

    public record AnswerOption(String id, String label, String answer) {}

    public record Clarification(
            String id, ClarificationKind kind, String question, List<AnswerOption> options) {
        public Clarification {
            options = options == null ? List.of() : List.copyOf(options);
        }
    }

    public record Apply(@Min(0) long revision, boolean allowStockShortage) {}

    public record Checkout(
            @Min(0) long revision, @NotNull @Valid BarcodeOrderCreateRequest order) {}

    public record Chat(String role, String content) {}

    public record Item(
            String source,
            Long productId,
            String name,
            BigDecimal quantity,
            MeasurementUnit measurementUnit,
            BigDecimal unitPrice,
            String issue,
            BarcodeOrderProductDto product) {}

    public record BuyerAliasSuggestion(String alias, UUID buyerId, String buyerName) {}

    public record Proposal(
            UUID regularBuyerId,
            String regularBuyerName,
            UUID supplierId,
            String supplierName,
            Long customerId,
            String pendingCustomerEmail,
            String pendingCustomerPhone,
            String comment,
            List<Item> items,
            List<String> questions,
            String buyerSource,
            String supplierSource,
            BuyerAliasSuggestion buyerAliasSuggestion,
            List<Clarification> clarifications,
            boolean buyerSelected) {
        public Proposal {
            clarifications = clarifications == null ? List.of() : List.copyOf(clarifications);
        }

        public Proposal(
                UUID regularBuyerId,
                String regularBuyerName,
                UUID supplierId,
                String supplierName,
                Long customerId,
                String pendingCustomerEmail,
                String pendingCustomerPhone,
                String comment,
                List<Item> items,
                List<String> questions,
                String buyerSource,
                String supplierSource,
                BuyerAliasSuggestion buyerAliasSuggestion) {
            this(
                    regularBuyerId,
                    regularBuyerName,
                    supplierId,
                    supplierName,
                    customerId,
                    pendingCustomerEmail,
                    pendingCustomerPhone,
                    comment,
                    items,
                    questions,
                    buyerSource,
                    supplierSource,
                    buyerAliasSuggestion,
                    List.of(),
                    false);
        }

        public Proposal(
                UUID regularBuyerId,
                String regularBuyerName,
                UUID supplierId,
                String supplierName,
                Long customerId,
                String pendingCustomerEmail,
                String pendingCustomerPhone,
                String comment,
                List<Item> items,
                List<String> questions,
                String buyerSource,
                String supplierSource) {
            this(
                    regularBuyerId,
                    regularBuyerName,
                    supplierId,
                    supplierName,
                    customerId,
                    pendingCustomerEmail,
                    pendingCustomerPhone,
                    comment,
                    items,
                    questions,
                    buyerSource,
                    supplierSource,
                    null);
        }
    }

    public record Session(
            UUID id,
            Mode mode,
            long revision,
            long appliedRevision,
            UUID orderId,
            PriceTier priceTier,
            LocalDate orderDate,
            List<Chat> messages,
            Proposal proposal,
            boolean ready) {}
}
