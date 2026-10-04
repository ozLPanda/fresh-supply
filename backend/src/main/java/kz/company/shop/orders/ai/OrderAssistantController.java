package kz.company.shop.orders.ai;

import jakarta.validation.Valid;
import java.util.UUID;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.orders.dto.OrderDto;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/order-assistant/sessions")
@PreAuthorize("hasAuthority('orders.update')")
public class OrderAssistantController {
    private final OrderAssistantService service;

    public OrderAssistantController(OrderAssistantService service) {
        this.service = service;
    }

    @PostMapping
    public ApiResponse<OrderAssistantDto.Session> start(
            @RequestBody @Valid OrderAssistantDto.Start request) {
        return ApiResponse.ok(service.start(request));
    }

    @GetMapping("/{id}")
    public ApiResponse<OrderAssistantDto.Session> get(@PathVariable UUID id) {
        return ApiResponse.ok(service.get(id));
    }

    @PostMapping("/{id}/messages")
    public ApiResponse<OrderAssistantDto.Session> message(
            @PathVariable UUID id, @RequestBody @Valid OrderAssistantDto.Message request) {
        return ApiResponse.ok(service.message(id, request));
    }

    @PatchMapping("/{id}/items")
    public ApiResponse<OrderAssistantDto.Session> editItems(
            @PathVariable UUID id, @RequestBody @Valid OrderAssistantDto.EditItems request) {
        return ApiResponse.ok(service.editItems(id, request));
    }

    @PostMapping("/{id}/apply")
    public ApiResponse<OrderAssistantDto.Session> apply(
            @PathVariable UUID id, @RequestBody @Valid OrderAssistantDto.Apply request) {
        return ApiResponse.ok(service.apply(id, request));
    }

    @PostMapping("/{id}/checkout")
    public ApiResponse<OrderDto> checkout(
            @PathVariable UUID id, @RequestBody @Valid OrderAssistantDto.Checkout request) {
        return ApiResponse.ok(service.checkout(id, request));
    }
}
