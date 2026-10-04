package kz.company.shop.worktime;

import static kz.company.shop.worktime.WorkTimeDto.*;

import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/work-time")
@PreAuthorize("hasAnyAuthority('pages.worktime.view','worktime.manage')")
public class WorkTimeController {
    private final WorkTimeService service;

    public WorkTimeController(WorkTimeService service) {
        this.service = service;
    }

    @GetMapping("/employees")
    public ApiResponse<List<Employee>> employees() {
        return ApiResponse.ok(service.employees());
    }

    @GetMapping("/{userId}")
    public ApiResponse<View> view(
            @PathVariable long userId, @RequestParam LocalDate from, @RequestParam LocalDate to) {
        return ApiResponse.ok(service.view(userId, from, to));
    }

    @PutMapping("/{userId}/settings")
    public ApiResponse<Void> settings(
            @PathVariable long userId, @Valid @RequestBody SettingsRequest req) {
        service.saveSettings(userId, req);
        return ApiResponse.message("Условия сохранены");
    }

    @PutMapping("/{userId}/days/{date}")
    public ApiResponse<Void> save(
            @PathVariable long userId,
            @PathVariable LocalDate date,
            @Valid @RequestBody SaveDay req) {
        service.saveDay(userId, date, req);
        return ApiResponse.message("День сохранён");
    }

    @DeleteMapping("/{userId}/days/{date}")
    public ApiResponse<Void> delete(
            @PathVariable long userId, @PathVariable LocalDate date, @RequestParam long version) {
        service.deleteDay(userId, date, version);
        return ApiResponse.message("День удалён");
    }

    @PostMapping("/{userId}/payments")
    public ApiResponse<Void> pay(@PathVariable long userId, @Valid @RequestBody RangeRequest req) {
        service.pay(userId, req);
        return ApiResponse.message("Выплата отмечена");
    }

    @PostMapping("/{userId}/transactions")
    public ApiResponse<Void> transaction(
            @PathVariable long userId, @Valid @RequestBody TransactionRequest req) {
        service.createTransaction(userId, req);
        return ApiResponse.message("Сумма выдана");
    }

    @PostMapping("/{userId}/reprice")
    public ApiResponse<Void> reprice(
            @PathVariable long userId, @Valid @RequestBody RangeRequest req) {
        service.reprice(userId, req);
        return ApiResponse.message("Неоплаченные дни пересчитаны");
    }

    @PostMapping("/{userId}/payments/{paymentId}/cancel")
    public ApiResponse<Void> cancel(
            @PathVariable long userId,
            @PathVariable long paymentId,
            @Valid @RequestBody CancelRequest req) {
        service.cancel(userId, paymentId, req.reason());
        return ApiResponse.message("Отметка выплаты отменена");
    }

    @PostMapping("/{userId}/transactions/{transactionId}/cancel")
    public ApiResponse<Void> cancelTransaction(
            @PathVariable long userId,
            @PathVariable long transactionId,
            @Valid @RequestBody CancelRequest req) {
        service.cancelTransaction(userId, transactionId, req.reason());
        return ApiResponse.message("Операция отменена");
    }
}
