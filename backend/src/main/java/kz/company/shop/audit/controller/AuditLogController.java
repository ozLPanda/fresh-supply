package kz.company.shop.audit.controller;

import java.time.LocalDate;
import kz.company.shop.audit.dto.AuditLogDto;
import kz.company.shop.audit.service.AuditLogQueryService;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/audit-logs")
public class AuditLogController {
    private final AuditLogQueryService service;
    private final AuthContext auth;

    public AuditLogController(AuditLogQueryService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('audit.read')")
    public ApiResponse<PageResult<AuditLogDto>> list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "25") int size) {
        auth.require("audit.read");
        return ApiResponse.ok(service.list(search, from, to, page, size));
    }
}
