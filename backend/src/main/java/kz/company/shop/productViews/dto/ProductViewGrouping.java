package kz.company.shop.productViews.dto;

import java.util.Locale;
import kz.company.shop.common.exception.AppExceptions;

public enum ProductViewGrouping {
    DAY,
    MONTH,
    YEAR;

    public static ProductViewGrouping from(String value) {
        if (value == null || value.isBlank()) return DAY;
        try {
            return valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException exception) {
            throw new AppExceptions.BadRequest("Группировка должна быть day, month или year");
        }
    }
}
