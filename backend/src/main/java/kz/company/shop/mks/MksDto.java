package kz.company.shop.mks;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class MksDto {
    private MksDto() {}

    public record Status(
            boolean configured, boolean connected, Instant lastConnectedAt, String message) {}

    public record SearchRequest(
            @Size(max = 250) String query,
            @Min(1) @Max(10000) int page,
            @Min(10) @Max(100) int size,
            Map<String, Object> filters) {}

    public record Product(
            String id,
            String sku,
            String name,
            String brand,
            String model,
            BigDecimal price,
            String availability,
            String unit,
            String imageUrl,
            String productUrl) {}

    public record Characteristic(String name, String value) {}

    public record ProductDetails(
            Product product,
            String barcode,
            BigDecimal retailPrice,
            BigDecimal minimumPrice,
            String series,
            String minQuantity,
            String innerQuantity,
            String outerQuantity,
            List<String> images,
            List<Characteristic> characteristics,
            String description,
            String advantages,
            String usage) {}

    public record Option(String value, String label) {}

    public record Filter(String id, String label, String type, List<Option> options) {}

    public record SearchResult(
            List<Product> items,
            int page,
            int size,
            Long totalItems,
            Integer totalPages,
            boolean hasMore,
            List<Filter> filters,
            List<String> warnings) {}
}
