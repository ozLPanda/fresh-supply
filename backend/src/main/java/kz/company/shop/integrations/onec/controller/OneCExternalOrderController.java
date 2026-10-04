package kz.company.shop.integrations.onec.controller;

import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.integrations.onec.dto.OneCOrderDto;
import kz.company.shop.integrations.onec.service.OneCExternalOrderService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/integrations/1c")
public class OneCExternalOrderController {
    private final OneCExternalOrderService orders;

    public OneCExternalOrderController(OneCExternalOrderService orders) {
        this.orders = orders;
    }

    @GetMapping("/orders/{displayCode}")
    public ApiResponse<OneCOrderDto> findOrder(
            @RequestHeader(value = "X-API-Key", required = false) String accessCode,
            @PathVariable String displayCode) {
        return ApiResponse.ok(orders.findOrder(accessCode, displayCode));
    }
}
