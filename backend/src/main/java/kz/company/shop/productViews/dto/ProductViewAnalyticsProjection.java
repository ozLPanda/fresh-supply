package kz.company.shop.productViews.dto;

/** Spring Data projection used only for the grouped product-view query. */
public interface ProductViewAnalyticsProjection {
    Long getProductId();

    String getSku();

    String getNameRu();

    String getCategoryNameRu();

    long getViews();
}
