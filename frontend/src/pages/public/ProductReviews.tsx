import {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ImagePlus, MessageSquare, Star } from "lucide-react";
import { API_URL } from "@/shared/api/http";
import { ALMATY_TIME_ZONE } from "@/shared/lib/dateTime";
import {
  createReview,
  fetchProductReviews,
  fetchProductReviewSummary,
  replyToReview,
} from "@/shared/api/reviews";
import { Review } from "@/shared/types/models";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppTextarea } from "@/shared/ui/AppField";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import { Pagination } from "@/pages/public/Pagination";
import "./ProductReviews.css";

const PAGE_SIZE = 5;
const MAX_FILES = 10;
const REVIEW_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isReviewImage(file: File) {
  return REVIEW_IMAGE_TYPES.has(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="product-reviews__stars" aria-label={`${rating} из 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} size={16} fill={index < rating ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-KZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: ALMATY_TIME_ZONE,
  }).format(new Date(value));
}

function fileTotal(files: File[]) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function formatMb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function ProductReviews({ productId }: { productId: number }) {
  const queryClient = useQueryClient();
  const { user } = useCommerce();
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const imageInputRef = useRef<HTMLInputElement>(null);

  const reviewsQuery = useQuery({
    queryKey: ["product-reviews", productId, page],
    queryFn: () => fetchProductReviews(productId, page, PAGE_SIZE),
  });
  const summaryQuery = useQuery({
    queryKey: ["product-review-summary", productId],
    queryFn: () => fetchProductReviewSummary(productId),
  });

  const submitReview = useMutation({
    mutationFn: () => createReview({ productId, rating, content, images }),
    onSuccess: async () => {
      setContent("");
      setImages([]);
      setRating(5);
      appToast.success("Отзыв отправлен на модерацию");
      await queryClient.invalidateQueries({ queryKey: ["product-reviews", productId] });
      await queryClient.invalidateQueries({ queryKey: ["product-review-summary", productId] });
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось отправить отзыв"),
  });

  const sendReply = useMutation({
    mutationFn: ({ reviewId, content }: { reviewId: number; content: string }) =>
      replyToReview(reviewId, content),
    onSuccess: async (_, variables) => {
      setReplyDrafts((current) => ({ ...current, [variables.reviewId]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["product-reviews", productId] });
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось отправить ответ"),
  });

  const reviews = reviewsQuery.data?.items ?? [];
  const summary = summaryQuery.data;
  const totalPages = reviewsQuery.data?.totalPages ?? 1;
  const currentFilesSize = useMemo(() => fileTotal(images), [images]);

  function addImages(files: File[]) {
    const nextImages = files.filter(isReviewImage);
    if (!nextImages.length) return false;

    setImages((current) => [...current, ...nextImages].slice(0, MAX_FILES));
    return true;
  }

  function onFilesChange(event: ChangeEvent<HTMLInputElement>) {
    addImages(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function onImagesPaste(event: ClipboardEvent<HTMLLabelElement>) {
    if (addImages(Array.from(event.clipboardData.files))) {
      event.preventDefault();
    }
  }

  function onImagesKeyDown(event: KeyboardEvent<HTMLLabelElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    imageInputRef.current?.click();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      appToast.error("Войдите в аккаунт, чтобы оставить отзыв");
      return;
    }
    if (content.trim().length < 10) {
      appToast.error("Напишите отзыв минимум на 10 символов");
      return;
    }
    void submitReview.mutate();
  }

  return (
    <section className="product-reviews">
      <div className="product-reviews__summary">
        <div>
          <p>Отзывы клиентов</p>
          <strong>{summary?.averageRating ? summary.averageRating.toFixed(1) : "0.0"}</strong>
          <Stars rating={Math.round(summary?.averageRating ?? 0)} />
          <span>{summary?.totalReviews ?? 0} отзывов</span>
        </div>
        <AppBadge tone="green">
          <CheckCircle2 size={14} />
          {summary?.verifiedReviews ?? 0} подтверждённых
        </AppBadge>
      </div>

      <form className="product-reviews__form" onSubmit={onSubmit}>
        <div className="product-reviews__rating" role="radiogroup" aria-label="Оценка">
          {Array.from({ length: 5 }, (_, index) => index + 1).map((value) => (
            <button
              key={value}
              type="button"
              className={value <= rating ? "is-active" : ""}
              onClick={() => setRating(value)}
              aria-label={`${value} из 5`}
            >
              <Star size={19} fill="currentColor" />
            </button>
          ))}
        </div>
        <AppTextarea
          label="Ваш отзыв"
          value={content}
          rows={4}
          maxLength={3000}
          placeholder="Расскажите о товаре, доставке или опыте монтажа"
          onChange={(event) => setContent(event.target.value)}
        />
        <div className="product-reviews__upload">
          <label
            tabIndex={0}
            aria-describedby="review-images-upload-hint"
            onPaste={onImagesPaste}
            onKeyDown={onImagesKeyDown}
          >
            <ImagePlus size={18} />
            <span>Прикрепить фото</span>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={onFilesChange}
            />
          </label>
          <small id="review-images-upload-hint">
            {images.length}/10 фото, выбрано {formatMb(currentFilesSize)}. Выберите фото или
            вставьте его из буфера обмена (Ctrl/Cmd+V).
          </small>
        </div>
        {images.length > 0 && (
          <div className="product-reviews__selected">
            {images.map((file) => (
              <span key={`${file.name}-${file.size}`}>{file.name}</span>
            ))}
          </div>
        )}
        <AppButton type="submit" loading={submitReview.isPending}>
          Отправить отзыв
        </AppButton>
        <p className="product-reviews__hint">
          Если вы заказывали этот товар, система отметит отзыв как подтверждённый. После проверки он
          появится на сайте.
        </p>
      </form>

      {reviewsQuery.isLoading ? (
        <AppSkeleton />
      ) : reviewsQuery.isError ? (
        <AppAlert tone="danger" title="Отзывы не загрузились">
          Попробуйте обновить страницу.
        </AppAlert>
      ) : reviews.length > 0 ? (
        <div className="product-reviews__list">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              canReply={user?.id === review.userId}
              replyDraft={replyDrafts[review.id] ?? ""}
              onReplyChange={(value) =>
                setReplyDrafts((current) => ({ ...current, [review.id]: value }))
              }
              onReply={() =>
                sendReply.mutate({ reviewId: review.id, content: replyDrafts[review.id] ?? "" })
              }
            />
          ))}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      ) : (
        <AppAlert title="Отзывов пока нет">
          Станьте первым клиентом, который расскажет о товаре.
        </AppAlert>
      )}
    </section>
  );
}

function ReviewCard({
  review,
  canReply,
  replyDraft,
  onReplyChange,
  onReply,
}: {
  review: Review;
  canReply: boolean;
  replyDraft: string;
  onReplyChange: (value: string) => void;
  onReply: () => void;
}) {
  const hasAdminReply = review.messages.some((message) => message.authorType === "ADMIN");
  return (
    <article className="product-review-card">
      <header>
        <div>
          <strong>{review.authorName}</strong>
          <span>{formatDate(review.createdAt)}</span>
        </div>
        <div className="product-review-card__meta">
          <Stars rating={review.rating} />
          {review.verified && <AppBadge tone="green">Подтверждённый</AppBadge>}
        </div>
      </header>
      <p>{review.content}</p>
      {review.images.length > 0 && (
        <div className="product-review-card__images">
          {review.images.map((image) => (
            <img key={image.id} src={`${API_URL}${image.filePath}`} alt={image.originalFileName} />
          ))}
        </div>
      )}
      {review.messages.length > 0 && (
        <div className="product-review-card__thread">
          {review.messages.map((message) => (
            <div
              key={message.id}
              className={`product-review-card__message ${message.authorType.toLowerCase()}`}
            >
              <b>{message.authorType === "ADMIN" ? "Администратор" : message.authorName}</b>
              <span>{formatDate(message.createdAt)}</span>
              <p>{message.content}</p>
            </div>
          ))}
        </div>
      )}
      {canReply && hasAdminReply && (
        <div className="product-review-card__reply">
          <AppTextarea
            value={replyDraft}
            rows={2}
            placeholder="Ответить администратору"
            onChange={(event) => onReplyChange(event.target.value)}
          />
          <AppButton type="button" variant="secondary" onClick={onReply}>
            <MessageSquare size={16} />
            Ответить
          </AppButton>
        </div>
      )}
    </article>
  );
}
