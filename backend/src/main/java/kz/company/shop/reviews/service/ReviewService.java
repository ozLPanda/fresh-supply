package kz.company.shop.reviews.service;

import java.util.List;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.reviews.dto.*;
import kz.company.shop.reviews.entity.*;
import kz.company.shop.reviews.repository.ReviewMessageRepository;
import kz.company.shop.reviews.repository.ReviewRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ReviewService {
    private static final int MAX_IMAGES = 10;
    private static final long VERIFIED_LIMIT = 100L * 1024 * 1024;
    private static final long REGULAR_LIMIT = 30L * 1024 * 1024;

    private final ReviewRepository reviews;
    private final ReviewMessageRepository messages;
    private final OrderRepository orders;
    private final ProductService products;
    private final FileStorageService files;

    public ReviewService(
            ReviewRepository reviews,
            ReviewMessageRepository messages,
            OrderRepository orders,
            ProductService products,
            FileStorageService files) {
        this.reviews = reviews;
        this.messages = messages;
        this.orders = orders;
        this.products = products;
        this.files = files;
    }

    @Transactional(readOnly = true)
    public PageResult<ReviewDto> productReviews(Long productId, int page, int size) {
        Page<Review> result =
                reviews.findByProductIdAndStatusOrderByCreatedAtDesc(
                        productId,
                        ReviewStatus.APPROVED,
                        PageRequest.of(safePage(page), safeSize(size)));
        return toPage(result);
    }

    @Transactional(readOnly = true)
    public PageResult<ReviewDto> latestApproved(int page, int size) {
        Page<Review> result =
                reviews.findByStatusOrderByCreatedAtDesc(
                        ReviewStatus.APPROVED, PageRequest.of(safePage(page), safeSize(size)));
        return toPage(result);
    }

    @Transactional(readOnly = true)
    public PageResult<ReviewDto> adminList(String status, int page, int size) {
        PageRequest pageable = PageRequest.of(safePage(page), safeSize(size));
        Page<Review> result =
                status == null || status.isBlank() || "ALL".equalsIgnoreCase(status)
                        ? reviews.findAllByOrderByCreatedAtDesc(pageable)
                        : reviews.findByStatusOrderByCreatedAtDesc(
                                ReviewStatus.valueOf(status), pageable);
        return toPage(result);
    }

    @Transactional(readOnly = true)
    public ReviewSummaryDto productSummary(Long productId) {
        return new ReviewSummaryDto(
                round(reviews.averageForProduct(productId, ReviewStatus.APPROVED)),
                reviews.countByStatusAndProductId(ReviewStatus.APPROVED, productId),
                reviews.countByStatusAndProductIdAndVerified(
                        ReviewStatus.APPROVED, productId, true));
    }

    @Transactional(readOnly = true)
    public ReviewSummaryDto overallSummary() {
        return new ReviewSummaryDto(
                round(reviews.averageApproved(ReviewStatus.APPROVED)),
                reviews.countByStatus(ReviewStatus.APPROVED),
                reviews.countByStatusAndVerified(ReviewStatus.APPROVED, true));
    }

    @Transactional
    public ReviewDto create(
            CurrentUser user, ReviewCreateRequest request, List<MultipartFile> images) {
        Product product = products.getEntity(request.productId());
        List<UUID> eligibleOrders = orders.findReviewEligibleOrderIds(user.id(), product.id);
        boolean verified = !eligibleOrders.isEmpty();
        List<MultipartFile> safeImages = images == null ? List.of() : images;
        validateImages(safeImages, verified);

        Review review = new Review();
        review.productId = product.id;
        review.userId = user.id();
        review.authorName = user.name();
        review.rating = request.rating();
        review.content = request.content().trim();
        review.verified = verified;
        review.verifiedOrderId = verified ? eligibleOrders.get(0) : null;
        review.status = ReviewStatus.PENDING;

        for (int index = 0; index < safeImages.size(); index++) {
            var stored = files.saveReviewImage(safeImages.get(index));
            ReviewImage image = new ReviewImage();
            image.review = review;
            image.fileName = stored.fileName();
            image.filePath = stored.publicPath();
            image.originalFileName = stored.originalFileName();
            image.fileSize = safeImages.get(index).getSize();
            image.sortOrder = index + 1;
            review.images.add(image);
        }
        return toDto(reviews.save(review));
    }

    @Transactional
    public ReviewDto updateStatus(Long id, ReviewStatus status) {
        Review review = get(id);
        review.status = status;
        return toDto(reviews.save(review));
    }

    @Transactional
    public ReviewDto adminReply(CurrentUser admin, Long id, ReviewMessageRequest request) {
        Review review = get(id);
        addMessage(
                review, admin.id(), admin.name(), ReviewMessageAuthorType.ADMIN, request.content());
        return toDto(get(id));
    }

    @Transactional
    public ReviewDto customerReply(CurrentUser user, Long id, ReviewMessageRequest request) {
        Review review = get(id);
        if (!review.userId.equals(user.id())) throw new AppExceptions.Forbidden("reviews.owner");
        boolean hasAdminReply =
                review.messages.stream()
                        .anyMatch(message -> message.authorType == ReviewMessageAuthorType.ADMIN);
        if (!hasAdminReply) {
            throw new AppExceptions.BadRequest("Ответить можно после ответа администратора");
        }
        addMessage(
                review,
                user.id(),
                user.name(),
                ReviewMessageAuthorType.CUSTOMER,
                request.content());
        return toDto(get(id));
    }

    private void addMessage(
            Review review,
            Long userId,
            String authorName,
            ReviewMessageAuthorType type,
            String content) {
        ReviewMessage message = new ReviewMessage();
        message.review = review;
        message.userId = userId;
        message.authorName = authorName;
        message.authorType = type;
        message.content = content.trim();
        messages.save(message);
    }

    private Review get(Long id) {
        return reviews.findById(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Отзыв не найден"));
    }

    private void validateImages(List<MultipartFile> images, boolean verified) {
        if (images.size() > MAX_IMAGES) {
            throw new AppExceptions.BadRequest("Можно прикрепить не более 10 фотографий");
        }
        long total = images.stream().mapToLong(MultipartFile::getSize).sum();
        long limit = verified ? VERIFIED_LIMIT : REGULAR_LIMIT;
        if (total > limit) {
            throw new AppExceptions.BadRequest(
                    verified
                            ? "Для подтверждённого отзыва лимит фотографий 100 МБ"
                            : "Для обычного отзыва лимит фотографий 30 МБ");
        }
    }

    private PageResult<ReviewDto> toPage(Page<Review> result) {
        return new PageResult<>(
                result.getContent().stream().map(this::toDto).toList(),
                result.getNumber() + 1,
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    private ReviewDto toDto(Review review) {
        Product product = products.getEntity(review.productId);
        return new ReviewDto(
                review.id,
                review.productId,
                product.nameRu,
                review.userId,
                review.authorName,
                review.rating,
                review.content,
                review.status,
                review.verified,
                review.verifiedOrderId,
                review.createdAt,
                review.images.stream()
                        .map(
                                image ->
                                        new ReviewImageDto(
                                                image.id,
                                                image.fileName,
                                                image.filePath,
                                                image.originalFileName,
                                                image.fileSize,
                                                image.sortOrder))
                        .toList(),
                review.messages.stream()
                        .map(
                                message ->
                                        new ReviewMessageDto(
                                                message.id,
                                                message.userId,
                                                message.authorName,
                                                message.authorType,
                                                message.content,
                                                message.createdAt))
                        .toList());
    }

    private int safePage(int page) {
        return Math.max(page, 1) - 1;
    }

    private int safeSize(int size) {
        return Math.min(Math.max(size, 1), 50);
    }

    private double round(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
