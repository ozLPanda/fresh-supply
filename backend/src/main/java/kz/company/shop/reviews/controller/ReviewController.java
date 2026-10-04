package kz.company.shop.reviews.controller;

import jakarta.validation.Valid;
import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.reviews.dto.*;
import kz.company.shop.reviews.service.ReviewService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class ReviewController {
    private final ReviewService service;
    private final AuthContext auth;

    public ReviewController(ReviewService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping("/products/{productId}/reviews")
    public ApiResponse<PageResult<ReviewDto>> productReviews(
            @PathVariable Long productId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "5") int size) {
        return ApiResponse.ok(service.productReviews(productId, page, size));
    }

    @GetMapping("/products/{productId}/reviews/summary")
    public ApiResponse<ReviewSummaryDto> productSummary(@PathVariable Long productId) {
        return ApiResponse.ok(service.productSummary(productId));
    }

    @GetMapping("/reviews/latest")
    public ApiResponse<PageResult<ReviewDto>> latest(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "3") int size) {
        return ApiResponse.ok(service.latestApproved(page, size));
    }

    @GetMapping("/reviews/summary")
    public ApiResponse<ReviewSummaryDto> summary() {
        return ApiResponse.ok(service.overallSummary());
    }

    @PostMapping("/reviews")
    public ApiResponse<ReviewDto> create(
            @RequestPart("review") @Valid ReviewCreateRequest request,
            @RequestPart(value = "images", required = false) List<MultipartFile> images) {
        return ApiResponse.ok(service.create(auth.current(), request, images));
    }

    @PostMapping("/reviews/{id}/messages")
    public ApiResponse<ReviewDto> customerReply(
            @PathVariable Long id, @RequestBody @Valid ReviewMessageRequest request) {
        return ApiResponse.ok(service.customerReply(auth.current(), id, request));
    }

    @GetMapping("/admin/reviews")
    @PreAuthorize("hasAuthority('reviews.read')")
    public ApiResponse<PageResult<ReviewDto>> adminList(
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size) {
        auth.require("reviews.read");
        return ApiResponse.ok(service.adminList(status, page, size));
    }

    @PatchMapping("/admin/reviews/{id}/status")
    @PreAuthorize("hasAuthority('reviews.update')")
    public ApiResponse<ReviewDto> updateStatus(
            @PathVariable Long id, @RequestBody @Valid ReviewStatusUpdateRequest request) {
        auth.require("reviews.update");
        return ApiResponse.ok(service.updateStatus(id, request.status()));
    }

    @PostMapping("/admin/reviews/{id}/messages")
    @PreAuthorize("hasAuthority('reviews.reply')")
    public ApiResponse<ReviewDto> adminReply(
            @PathVariable Long id, @RequestBody @Valid ReviewMessageRequest request) {
        auth.require("reviews.reply");
        return ApiResponse.ok(service.adminReply(auth.current(), id, request));
    }
}
