package kz.company.shop.procurement.controller;

import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.files.service.ObjectStorageService;
import kz.company.shop.procurement.dto.*;
import kz.company.shop.procurement.entity.ProcurementStatus;
import kz.company.shop.procurement.service.ProcurementService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/api/admin/procurement")
public class ProcurementController {
    private final ProcurementService service;
    private final AuthContext auth;
    private final ObjectStorageService storage;

    public ProcurementController(
            ProcurementService service, AuthContext auth, ObjectStorageService storage) {
        this.service = service;
        this.auth = auth;
        this.storage = storage;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('procurement.read')")
    public ApiResponse<PageResult<ProcurementProjectDto>> list(
            @RequestParam(required = false) ProcurementStatus status,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        auth.require("procurement.read");
        return ApiResponse.ok(service.list(status, search, page, size));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementProjectDto> create(
            @RequestBody @Valid ProcurementProjectRequest request) {
        auth.require("procurement.manage");
        return ApiResponse.ok(service.create(request, auth.current()));
    }

    @GetMapping("/{projectId}")
    @PreAuthorize("hasAuthority('procurement.read')")
    public ApiResponse<ProcurementProjectDto> get(@PathVariable Long projectId) {
        auth.require("procurement.read");
        return ApiResponse.ok(service.get(projectId));
    }

    @PutMapping("/{projectId}")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementProjectDto> update(
            @PathVariable Long projectId, @RequestBody @Valid ProcurementProjectRequest request) {
        auth.require("procurement.manage");
        return ApiResponse.ok(service.update(projectId, request));
    }

    @DeleteMapping("/{projectId}")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<Void> delete(@PathVariable Long projectId) {
        auth.require("procurement.manage");
        service.delete(projectId);
        return ApiResponse.message("Проект удалён");
    }

    @PatchMapping("/{projectId}/status")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementProjectDto> changeStatus(
            @PathVariable Long projectId,
            @RequestBody @Valid ProcurementStatusChangeRequest request) {
        auth.require("procurement.manage");
        return ApiResponse.ok(service.changeStatus(projectId, request, auth.current()));
    }

    @GetMapping("/{projectId}/status-history")
    @PreAuthorize("hasAuthority('procurement.history')")
    public ApiResponse<List<ProcurementStatusHistoryDto>> history(@PathVariable Long projectId) {
        auth.require("procurement.history");
        return ApiResponse.ok(service.history(projectId));
    }

    @PostMapping("/{projectId}/companies")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementCompanyDto> addCompany(
            @PathVariable Long projectId, @RequestBody @Valid ProcurementCompanyRequest request) {
        auth.require("procurement.manage");
        return ApiResponse.ok(service.addCompany(projectId, request));
    }

    @PutMapping("/{projectId}/companies/{companyId}")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementCompanyDto> updateCompany(
            @PathVariable Long projectId,
            @PathVariable Long companyId,
            @RequestBody @Valid ProcurementCompanyRequest request) {
        auth.require("procurement.manage");
        return ApiResponse.ok(service.updateCompany(projectId, companyId, request));
    }

    @DeleteMapping("/{projectId}/companies/{companyId}")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<Void> deleteCompany(
            @PathVariable Long projectId, @PathVariable Long companyId) {
        auth.require("procurement.manage");
        service.deleteCompany(projectId, companyId);
        return ApiResponse.message("Компания удалена");
    }

    @GetMapping("/{projectId}/companies/{companyId}/notes")
    @PreAuthorize("hasAuthority('procurement.read')")
    public ApiResponse<List<ProcurementCompanyNoteDto>> listCompanyNotes(
            @PathVariable Long projectId, @PathVariable Long companyId) {
        auth.require("procurement.read");
        return ApiResponse.ok(service.listCompanyNotes(projectId, companyId));
    }

    @PostMapping("/{projectId}/companies/{companyId}/notes")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementCompanyNoteDto> addCompanyNote(
            @PathVariable Long projectId,
            @PathVariable Long companyId,
            @RequestBody @Valid ProcurementCompanyNoteRequest request) {
        auth.require("procurement.manage");
        return ApiResponse.ok(
                service.addCompanyNote(projectId, companyId, request, auth.current()));
    }

    @PutMapping("/{projectId}/companies/{companyId}/notes/{noteId}")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementCompanyNoteDto> updateCompanyNote(
            @PathVariable Long projectId,
            @PathVariable Long companyId,
            @PathVariable Long noteId,
            @RequestBody @Valid ProcurementCompanyNoteRequest request) {
        auth.require("procurement.manage");
        return ApiResponse.ok(
                service.updateCompanyNote(projectId, companyId, noteId, request, auth.current()));
    }

    @DeleteMapping("/{projectId}/companies/{companyId}/notes/{noteId}")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<Void> deleteCompanyNote(
            @PathVariable Long projectId, @PathVariable Long companyId, @PathVariable Long noteId) {
        auth.require("procurement.manage");
        service.deleteCompanyNote(projectId, companyId, noteId, auth.current());
        return ApiResponse.message("Заметка удалена");
    }

    @PostMapping(value = "/{projectId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementFileDto> uploadProjectFile(
            @PathVariable Long projectId,
            @RequestParam String displayName,
            @RequestParam MultipartFile file) {
        auth.require("procurement.manage");
        return ApiResponse.ok(
                service.uploadProjectFile(projectId, displayName, file, auth.current()));
    }

    @PostMapping(
            value = "/{projectId}/companies/{companyId}/files",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementFileDto> uploadCompanyFile(
            @PathVariable Long projectId,
            @PathVariable Long companyId,
            @RequestParam String displayName,
            @RequestParam MultipartFile file) {
        auth.require("procurement.manage");
        return ApiResponse.ok(
                service.uploadCompanyFile(projectId, companyId, displayName, file, auth.current()));
    }

    @PutMapping("/{projectId}/files/{fileId}/text")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<ProcurementFileDto> updateTextFile(
            @PathVariable Long projectId,
            @PathVariable Long fileId,
            @RequestBody @Valid ProcurementTextFileUpdateRequest request) {
        auth.require("procurement.manage");
        return ApiResponse.ok(service.updateTextFile(projectId, fileId, request));
    }

    @DeleteMapping("/{projectId}/files/{fileId}")
    @PreAuthorize("hasAuthority('procurement.manage')")
    public ApiResponse<Void> deleteFile(@PathVariable Long projectId, @PathVariable Long fileId) {
        auth.require("procurement.manage");
        service.deleteFile(projectId, fileId);
        return ApiResponse.message("Файл удалён");
    }

    @GetMapping("/{projectId}/files/{fileId}/download")
    @PreAuthorize("hasAuthority('procurement.read')")
    public ResponseEntity<StreamingResponseBody> downloadFile(
            @PathVariable Long projectId, @PathVariable Long fileId) {
        auth.require("procurement.read");
        var file = service.getFile(projectId, fileId);
        var object = storage.get("uploads/" + file.fileName);
        MediaType contentType = safeContentType(file.contentType, file.originalFileName);
        var disposition =
                ("image".equalsIgnoreCase(contentType.getType())
                                ? ContentDisposition.inline()
                                : ContentDisposition.attachment())
                        .filename(file.originalFileName, StandardCharsets.UTF_8)
                        .build();
        StreamingResponseBody body =
                output -> {
                    try (var stream = object.stream()) {
                        stream.transferTo(output);
                    }
                };
        return ResponseEntity.ok()
                .contentType(contentType)
                .contentLength(object.size())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(body);
    }

    @PostMapping("/{projectId}/payments")
    @PreAuthorize("hasAuthority('procurement.payments')")
    public ApiResponse<ProcurementPaymentDto> addPayment(
            @PathVariable Long projectId, @RequestBody @Valid ProcurementPaymentRequest request) {
        auth.require("procurement.payments");
        return ApiResponse.ok(service.addPayment(projectId, request, auth.current()));
    }

    @PutMapping("/{projectId}/payments/{paymentId}")
    @PreAuthorize("hasAuthority('procurement.payments')")
    public ApiResponse<ProcurementPaymentDto> updatePayment(
            @PathVariable Long projectId,
            @PathVariable Long paymentId,
            @RequestBody @Valid ProcurementPaymentRequest request) {
        auth.require("procurement.payments");
        return ApiResponse.ok(service.updatePayment(projectId, paymentId, request));
    }

    @DeleteMapping("/{projectId}/payments/{paymentId}")
    @PreAuthorize("hasAuthority('procurement.payments')")
    public ApiResponse<Void> deletePayment(
            @PathVariable Long projectId, @PathVariable Long paymentId) {
        auth.require("procurement.payments");
        service.deletePayment(projectId, paymentId);
        return ApiResponse.message("Оплата удалена");
    }

    private static MediaType safeContentType(String contentType, String filename) {
        try {
            MediaType parsed = MediaType.parseMediaType(contentType);
            if (!MediaType.APPLICATION_OCTET_STREAM.includes(parsed)) return parsed;
        } catch (IllegalArgumentException | NullPointerException ignored) {
        }
        return MediaTypeFactory.getMediaType(filename).orElse(MediaType.APPLICATION_OCTET_STREAM);
    }
}
