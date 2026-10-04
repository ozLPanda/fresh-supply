package kz.company.shop.orders.dto;

import java.util.List;

public record OrderActivityFilterOptionsDto(List<UserOption> users, List<ActionOption> actions) {
    public record UserOption(Long id, String name) {}

    /** Only actions which actually occur in this order's history are returned. */
    public record ActionOption(String category, String value, String label) {}
}
