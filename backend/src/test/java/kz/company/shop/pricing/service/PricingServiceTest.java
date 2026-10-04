package kz.company.shop.pricing.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.products.entity.Product;
import org.junit.jupiter.api.Test;

class PricingServiceTest {
    @Test
    void appliesPersonalDiscountToRetailPrice() {
        PricingService service = new PricingService();
        Product product = product(new BigDecimal("1000.00"), new BigDecimal("800.00"));

        PricingService.CartPricing price =
                service.calculateCart(
                        List.of(new PricingService.CartPricingLine(product, 2)),
                        Set.of(),
                        new BigDecimal("15"));

        assertThat(price.priceTier()).isEqualTo(PriceTier.RETAIL);
        assertThat(price.unitPrices().get(product.id)).isEqualByComparingTo("850");
    }

    @Test
    void unlocksBulkWholesaleFromItsOwnSubtotalRatherThanWholesaleSubtotal() {
        PricingService service = new PricingService();
        Product product = product(new BigDecimal("1000"), new BigDecimal("900"));
        product.bulkWholesalePrice = new BigDecimal("800");
        product.skoPrice = new BigDecimal("700");

        PricingService.CartPricing pricing =
                service.calculateCart(
                        List.of(new PricingService.CartPricingLine(product, 313)),
                        Set.of(
                                PricingService.WHOLESALE_PERMISSION,
                                PricingService.BULK_WHOLESALE_PERMISSION,
                                PricingService.SKO_PERMISSION),
                        BigDecimal.ZERO);

        assertThat(pricing.priceTier()).isEqualTo(PriceTier.BULK_WHOLESALE);
        assertThat(pricing.unitPrices().get(product.id)).isEqualByComparingTo("800");
        assertThat(pricing.tiers())
                .anySatisfy(
                        tier -> {
                            assertThat(tier.tier()).isEqualTo(PriceTier.BULK_WHOLESALE);
                            assertThat(tier.subtotal()).isEqualByComparingTo("250400");
                            assertThat(tier.available()).isTrue();
                        });
    }

    @Test
    void keepsRetailPriceUntilCustomerEnablesDiscountPrices() {
        PricingService service = new PricingService();
        Product product = product(new BigDecimal("1000"), new BigDecimal("800"));

        PricingService.CartPricing pricing =
                service.calculateCart(
                        List.of(new PricingService.CartPricingLine(product, 2)),
                        Set.of(PricingService.WHOLESALE_PERMISSION),
                        BigDecimal.ZERO,
                        false);

        assertThat(pricing.priceTier()).isEqualTo(PriceTier.RETAIL);
        assertThat(pricing.unitPrices().get(product.id)).isEqualByComparingTo("1000");
    }

    @Test
    void blocksLevelWhenAnyCartPositionHasNoExplicitTierPrice() {
        PricingService service = new PricingService();
        Product priced = product(new BigDecimal("1000"), new BigDecimal("900"));
        priced.id = 1L;
        priced.bulkWholesalePrice = new BigDecimal("800");
        Product missing = product(new BigDecimal("1000"), new BigDecimal("900"));
        missing.id = 2L;

        PricingService.CartPricing pricing =
                service.calculateCart(
                        List.of(
                                new PricingService.CartPricingLine(priced, 400),
                                new PricingService.CartPricingLine(missing, 1)),
                        Set.of(
                                PricingService.WHOLESALE_PERMISSION,
                                PricingService.BULK_WHOLESALE_PERMISSION),
                        BigDecimal.ZERO);

        assertThat(pricing.priceTier()).isEqualTo(PriceTier.WHOLESALE);
        assertThat(pricing.tiers())
                .anySatisfy(
                        tier -> {
                            assertThat(tier.tier()).isEqualTo(PriceTier.BULK_WHOLESALE);
                            assertThat(tier.subtotal()).isEqualByComparingTo("320000");
                            assertThat(tier.missingPriceItemCount()).isEqualTo(1);
                            assertThat(tier.available()).isFalse();
                        });
    }

    private Product product(BigDecimal price, BigDecimal wholesalePrice) {
        Product product = new Product();
        product.id = 1L;
        product.price = price;
        product.wholesalePrice = wholesalePrice;
        return product;
    }
}
