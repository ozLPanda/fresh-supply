package kz.company.shop.products.dto;

import java.util.List;

/** Values actually present in a product's history, for compact context-aware filters. */
public record ProductActivityFilterOptionsDto(
        List<UserOption> users, List<TypeOption> types) {
    public record UserOption(Long id, String name) {}

    public record TypeOption(String category, String type, String label) {}
}
