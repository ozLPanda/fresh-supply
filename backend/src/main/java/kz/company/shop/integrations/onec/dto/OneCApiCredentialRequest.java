package kz.company.shop.integrations.onec.dto;

import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.Set;

public record OneCApiCredentialRequest(
        @NotBlank @Size(max = 160) String name,
        @NotEmpty Set<@Pattern(regexp = "orders\\.read") String> permissions,
        @Future Instant expiresAt) {}
