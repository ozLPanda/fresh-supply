import { api } from "@/shared/api/http";
import { PagedResult, Review, ReviewStatus, ReviewSummary } from "@/shared/types/models";

export function fetchProductReviews(productId: number, page = 1, size = 5) {
  return api<PagedResult<Review>>(`/api/products/${productId}/reviews?page=${page}&size=${size}`);
}

export function fetchProductReviewSummary(productId: number) {
  return api<ReviewSummary>(`/api/products/${productId}/reviews/summary`);
}

export function fetchLatestReviews(size = 3) {
  return api<PagedResult<Review>>(`/api/reviews/latest?page=1&size=${size}`);
}

export function fetchReviewSummary() {
  return api<ReviewSummary>("/api/reviews/summary");
}

export function createReview(input: {
  productId: number;
  rating: number;
  content: string;
  images: File[];
}) {
  const form = new FormData();
  form.append(
    "review",
    new Blob(
      [
        JSON.stringify({
          productId: input.productId,
          rating: input.rating,
          content: input.content,
        }),
      ],
      { type: "application/json" },
    ),
  );
  input.images.forEach((file) => form.append("images", file));
  return api<Review>("/api/reviews", { method: "POST", body: form });
}

export function replyToReview(reviewId: number, content: string) {
  return api<Review>(`/api/reviews/${reviewId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function fetchAdminReviews(status: ReviewStatus | "ALL", page = 1, size = 10) {
  return api<PagedResult<Review>>(`/api/admin/reviews?status=${status}&page=${page}&size=${size}`);
}

export function updateReviewStatus(reviewId: number, status: ReviewStatus) {
  return api<Review>(`/api/admin/reviews/${reviewId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function adminReplyToReview(reviewId: number, content: string) {
  return api<Review>(`/api/admin/reviews/${reviewId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}
