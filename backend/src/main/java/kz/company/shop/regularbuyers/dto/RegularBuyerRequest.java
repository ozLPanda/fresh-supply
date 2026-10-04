package kz.company.shop.regularbuyers.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RegularBuyerRequest(
        @NotBlank @Size(max = 240) String name,
        @Size(max = 160) String contactName,
        @Size(max = 64) String phone,
        @Email @Size(max = 254) String email,
        @Size(max = 2000) String comment,
        boolean archived,
        @Pattern(regexp = "[0-9]{12}", message = "ИИН/БИН должен содержать 12 цифр") String taxId,
        @Size(max = 1000) String legalAddress) {
    public RegularBuyerRequest {
        taxId = taxId == null || taxId.isBlank() ? null : taxId.trim();
        legalAddress = legalAddress == null || legalAddress.isBlank() ? null : legalAddress.trim();
    }

    public RegularBuyerRequest(String name, String contactName, String phone, String email,
            String comment, boolean archived) {
        this(name, contactName, phone, email, comment, archived, null, null);
    }
}
