package kz.company.shop.worktime;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public final class WorkTimeDto {
    public record Interval(@Min(0) @Max(1439) int start, @Min(1) @Max(1440) int end) {}

    public record Settings(BigDecimal dailyRate, int normMinutes, long version) {}

    public record SettingsRequest(
            @NotNull
                    @DecimalMin("0.00")
                    @DecimalMax("9999999.99")
                    @Digits(integer = 7, fraction = 2)
                    BigDecimal dailyRate,
            @Min(1) @Max(1440) int normMinutes,
            @Min(-1) long version) {}

    public record Day(
            long id,
            LocalDate date,
            BigDecimal dailyRate,
            int normMinutes,
            int minutes,
            BigDecimal amount,
            String note,
            long version,
            Long paymentId,
            List<Interval> intervals,
            List<AdditionalPayment> additionalPayments) {}

    public record AdditionalPayment(
            @NotBlank @Size(max = 255) String title,
            @NotNull
                    @DecimalMin("0.01")
                    @DecimalMax("9999999.99")
                    @Digits(integer = 7, fraction = 2)
                    BigDecimal amount) {}

    public record SaveDay(
            @NotEmpty @Size(max = 24) List<@NotNull @Valid Interval> intervals,
            @Size(max = 1000) String note,
            @Min(-1) long version,
            @Size(max = 50) List<@NotNull @Valid AdditionalPayment> additionalPayments) {
        public SaveDay(List<Interval> intervals, String note, long version) {
            this(intervals, note, version, List.of());
        }
    }

    public record Expected(long id, long version) {}

    public record RangeRequest(
            @NotNull LocalDate from,
            @NotNull LocalDate to,
            @NotNull @Size(max = 3661) List<@NotNull @Valid Expected> expected,
            Long settingsVersion,
            LocalDate paidOn,
            @Size(max = 1000) String note) {}

    public record CancelRequest(@NotBlank @Size(max = 1000) String reason) {}

    public record TransactionRequest(
            @NotNull LocalDate occurredOn,
            @NotNull
                    @DecimalMin("0.01")
                    @DecimalMax("9999999.99")
                    @Digits(integer = 7, fraction = 2)
                    BigDecimal amount,
            @Size(max = 1000) String note) {}

    public record Employee(long id, String name) {}

    public record Payment(
            long id,
            LocalDate from,
            LocalDate to,
            LocalDate paidOn,
            BigDecimal amount,
            String note,
            String createdBy,
            String cancelledAt,
            String cancelReason) {}

    public record Transaction(
            long id,
            LocalDate occurredOn,
            BigDecimal amount,
            String note,
            String createdBy,
            String createdAt,
            String cancelledAt,
            String cancelledBy,
            String cancelReason) {}

    public record Balance(
            BigDecimal amount,
            long days,
            long minutes,
            LocalDate firstUnpaid,
            LocalDate lastMarked,
            long unpricedDays) {}

    public record View(
            long userId,
            String name,
            boolean canManage,
            Settings settings,
            List<Day> days,
            List<Payment> payments,
            List<Transaction> transactions,
            Balance balance) {}
}
