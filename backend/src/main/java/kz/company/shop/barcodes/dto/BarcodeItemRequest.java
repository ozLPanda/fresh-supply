package kz.company.shop.barcodes.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@JsonIgnoreProperties(ignoreUnknown = true)
public record BarcodeItemRequest(
        @NotBlank(message = "Barcode value is required")
                @Size(max = 48, message = "Barcode value must not exceed 48 characters")
                @Pattern(
                        regexp = "[\\x20-\\x7E]+",
                        message = "Barcode value may contain only printable ASCII characters")
                String value,
        String name,
        @Min(value = 1, message = "Quantity must be at least 1")
                @Max(value = 100, message = "Quantity must not exceed 100")
                Integer quantity) {
    public BarcodeItemRequest(String value, Integer quantity) {
        this(value, null, quantity);
    }
}
