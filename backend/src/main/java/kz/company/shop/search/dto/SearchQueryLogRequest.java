package kz.company.shop.search.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import kz.company.shop.search.SearchQuerySource;

public record SearchQueryLogRequest(
        @NotBlank @Size(max = 500) String query,
        @NotNull SearchQuerySource source,
        @Size(max = 180) String categorySlug) {}
