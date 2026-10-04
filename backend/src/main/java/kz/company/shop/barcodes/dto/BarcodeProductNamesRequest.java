package kz.company.shop.barcodes.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;

public record BarcodeProductNamesRequest(
        @NotEmpty @Size(max = 500) List<@NotBlank @Size(max = 48) String> skus) {}
