package kz.company.shop.supplierproducts;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import kz.company.shop.mks.MksDto;

public final class SupplierProductDto {
    private SupplierProductDto() {}

    public record Supplier(String code, String name) {}

    public record Product(
            long id,
            String supplierCode,
            String supplierName,
            String externalId,
            String sku,
            String name,
            String description,
            String imageUrl,
            List<String> images,
            BigDecimal purchasePrice,
            BigDecimal retailPrice,
            String brand,
            String availability,
            MksDto.ProductDetails details,
            Instant syncedAt) {}

    public record ProductPage(
            List<Product> items, int page, int size, long totalItems, long totalPages) {}

    public record ImportRequest(
            String supplierCode,
            String scope,
            List<String> productIds,
            String query,
            Map<String, Object> filters,
            List<String> categoryIds) {}

    public record ImportJob(
            long id,
            String supplierCode,
            String supplierName,
            String scope,
            String status,
            long discovered,
            long processed,
            long failed,
            long pending,
            String error,
            Instant createdAt,
            Instant updatedAt) {}

    public record SyncStatus(
            long totalProducts,
            long activeJobs,
            long pending,
            long failed,
            Instant lastSyncedAt,
            Instant nextSyncAt) {}
}
