package kz.company.shop.search.controller;

import jakarta.validation.Valid;
import java.time.Instant;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.search.dto.SearchQueryLogRequest;
import kz.company.shop.search.service.SearchQueryLogService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/search-queries")
public class SearchQueryLogController {
    private final SearchQueryLogService service;
    private final AuthContext auth;

    public SearchQueryLogController(SearchQueryLogService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @PostMapping
    public ApiResponse<Void> record(@RequestBody @Valid SearchQueryLogRequest request) {
        service.record(
                request.query(),
                request.source(),
                request.categorySlug(),
                auth.optional().map(user -> user.id()).orElse(null),
                Instant.now());
        return ApiResponse.message("Search query accepted");
    }
}
