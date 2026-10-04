package kz.company.shop.pricing.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.products.entity.Product;
import org.springframework.stereotype.Service;

@Service
public class PricingService {
    public static final String WHOLESALE_PERMISSION = "commerce.prices.wholesale";
    public static final String BULK_WHOLESALE_PERMISSION = "commerce.prices.bulkWholesale";
    public static final String SKO_PERMISSION = "commerce.prices.sko";
    public static final BigDecimal BULK_WHOLESALE_THRESHOLD = new BigDecimal("250000");
    public static final BigDecimal SKO_THRESHOLD = new BigDecimal("350000");

    public BigDecimal discountedRetailPrice(
            BigDecimal retailPrice, BigDecimal personalDiscountPercent) {
        if (retailPrice == null
                || personalDiscountPercent == null
                || personalDiscountPercent.compareTo(BigDecimal.ZERO) <= 0) {
            return retailPrice;
        }
        return retailPrice
                .multiply(BigDecimal.ONE.subtract(personalDiscountPercent.movePointLeft(2)))
                .setScale(0, RoundingMode.HALF_UP);
    }

    public CartPricing calculateCart(
            List<CartPricingLine> lines,
            Set<String> permissions,
            BigDecimal personalDiscountPercent) {
        return calculateCart(lines, permissions, personalDiscountPercent, true);
    }

    /**
     * Calculates the cart using retail prices by default. Price levels are applied only after the
     * customer explicitly opts in; permissions are still checked here and cannot be bypassed by a
     * request from the browser.
     */
    public CartPricing calculateCart(
            List<CartPricingLine> lines,
            Set<String> permissions,
            BigDecimal personalDiscountPercent,
            boolean useDiscountPrices) {
        Set<String> grantedPermissions = permissions == null ? Set.of() : permissions;
        List<CartTierProgress> tiers =
                List.of(
                        progress(PriceTier.RETAIL, lines, true, null),
                        progress(
                                PriceTier.WHOLESALE,
                                lines,
                                grantedPermissions.contains(WHOLESALE_PERMISSION),
                                null),
                        progress(
                                PriceTier.BULK_WHOLESALE,
                                lines,
                                grantedPermissions.contains(WHOLESALE_PERMISSION)
                                        && grantedPermissions.contains(BULK_WHOLESALE_PERMISSION),
                                BULK_WHOLESALE_THRESHOLD),
                        progress(
                                PriceTier.SKO,
                                lines,
                                grantedPermissions.contains(WHOLESALE_PERMISSION)
                                        && grantedPermissions.contains(BULK_WHOLESALE_PERMISSION)
                                        && grantedPermissions.contains(SKO_PERMISSION),
                                SKO_THRESHOLD));

        PriceTier appliedTier = PriceTier.RETAIL;
        if (useDiscountPrices) {
            for (CartTierProgress tier : tiers) {
                if (tier.available()) appliedTier = tier.tier();
            }
        }

        Map<Long, BigDecimal> unitPrices = new LinkedHashMap<>();
        for (CartPricingLine line : lines) {
            BigDecimal price =
                    appliedTier == PriceTier.RETAIL
                            ? discountedRetailPrice(line.product().price, personalDiscountPercent)
                            : priceForTier(line.product(), appliedTier);
            unitPrices.put(line.product().id, price);
        }
        return new CartPricing(appliedTier, unitPrices, tiers);
    }

    private CartTierProgress progress(
            PriceTier tier,
            List<CartPricingLine> lines,
            boolean permissionAvailable,
            BigDecimal threshold) {
        BigDecimal subtotal = BigDecimal.ZERO;
        int missingPriceItemCount = 0;
        for (CartPricingLine line : lines) {
            BigDecimal price = priceForTier(line.product(), tier);
            if (price == null || price.compareTo(BigDecimal.ZERO) <= 0) {
                missingPriceItemCount++;
                continue;
            }
            subtotal = subtotal.add(price.multiply(BigDecimal.valueOf(line.quantity())));
        }
        BigDecimal remaining =
                threshold == null
                        ? BigDecimal.ZERO
                        : threshold.subtract(subtotal).max(BigDecimal.ZERO);
        boolean available =
                tier == PriceTier.RETAIL
                        || (!lines.isEmpty()
                                && permissionAvailable
                                && missingPriceItemCount == 0
                                && (threshold == null
                                        || remaining.compareTo(BigDecimal.ZERO) == 0));
        return new CartTierProgress(
                tier,
                permissionAvailable,
                available,
                subtotal,
                threshold,
                remaining,
                missingPriceItemCount);
    }

    public BigDecimal priceForTier(Product product, PriceTier tier) {
        return switch (tier) {
            case RETAIL -> product.price;
            case WHOLESALE -> product.wholesalePrice;
            case BULK_WHOLESALE -> product.bulkWholesalePrice;
            case SKO -> product.skoPrice;
        };
    }

    public record CartPricingLine(Product product, int quantity) {}

    public record CartTierProgress(
            PriceTier tier,
            boolean permissionAvailable,
            boolean available,
            BigDecimal subtotal,
            BigDecimal threshold,
            BigDecimal remaining,
            int missingPriceItemCount) {}

    public record CartPricing(
            PriceTier priceTier, Map<Long, BigDecimal> unitPrices, List<CartTierProgress> tiers) {}
}
