import { type MouseEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff, MessageSquare, ShieldCheck, Star, X } from "lucide-react";
import { adminReplyToReview, fetchAdminReviews, updateReviewStatus } from "@/shared/api/reviews";
import { Review, ReviewStatus } from "@/shared/types/models";
import { ALMATY_TIME_ZONE } from "@/shared/lib/dateTime";
import { AdminPage } from "@/layouts/AdminPage";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import { AppTextarea } from "@/shared/ui/AppField";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppContextMenu, type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { appToast } from "@/shared/ui/AppToast";
import "./ReviewsPage.css";

const statusLabels: Record<ReviewStatus, string> = {
  PENDING: "На модерации",
  APPROVED: "Опубликован",
  REJECTED: "Отклонён",
  HIDDEN: "Скрыт",
};

const statusTones: Record<ReviewStatus, "green" | "orange" | "red" | "slate"> = {
  PENDING: "orange",
  APPROVED: "green",
  REJECTED: "red",
  HIDDEN: "slate",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-KZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: ALMATY_TIME_ZONE,
  }).format(new Date(value));
}

export function ReviewsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReviewStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [reviewContextMenu, setReviewContextMenu] = useState<{
    review: Review;
    x: number;
    y: number;
  } | null>(null);

  const reviewsQuery = useQuery({
    queryKey: ["admin-reviews", status, page],
    queryFn: () => fetchAdminReviews(status, page, 10),
  });
  const reviews = reviewsQuery.data?.items ?? [];
  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0];

  const statusMutation = useMutation({
    mutationFn: ({ reviewId, next }: { reviewId: number; next: ReviewStatus }) =>
      updateReviewStatus(reviewId, next),
    onSuccess: async () => {
      appToast.success("Статус отзыва обновлён");
      await queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось обновить статус"),
  });

  const replyMutation = useMutation({
    mutationFn: () => adminReplyToReview(selected!.id, reply),
    onSuccess: async () => {
      setReply("");
      appToast.success("Ответ опубликован");
      await queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось отправить ответ"),
  });

  const metrics = useMemo(
    () => ({
      pending: reviews.filter((review) => review.status === "PENDING").length,
      verified: reviews.filter((review) => review.verified).length,
    }),
    [reviews],
  );

  function reviewActions(review: Review): AppContextMenuAction[] {
    return [
      {
        label: "Опубликовать",
        icon: <Check size={16} />,
        disabled: review.status === "APPROVED",
        onSelect: () => statusMutation.mutate({ reviewId: review.id, next: "APPROVED" }),
      },
      {
        label: "Отклонить",
        icon: <X size={16} />,
        disabled: review.status === "REJECTED",
        onSelect: () => statusMutation.mutate({ reviewId: review.id, next: "REJECTED" }),
      },
      {
        label: "Скрыть",
        icon: <EyeOff size={16} />,
        disabled: review.status === "HIDDEN",
        onSelect: () => statusMutation.mutate({ reviewId: review.id, next: "HIDDEN" }),
      },
    ];
  }

  function openReviewContextMenu(review: Review, event: MouseEvent<HTMLTableRowElement>) {
    event.preventDefault();
    setReviewContextMenu({ review, x: event.clientX, y: event.clientY });
  }

  const columns: AppDataTableColumn<Review>[] = [
    {
      id: "product",
      header: "Товар",
      value: (review) => review.productName,
      cell: (review) => (
        <button
          type="button"
          className="reviews-page__row-title"
          onClick={() => setSelectedId(review.id)}
        >
          <strong>{review.productName}</strong>
          <span>{review.authorName}</span>
        </button>
      ),
      sortable: true,
    },
    {
      id: "rating",
      header: "Оценка",
      value: (review) => review.rating,
      cell: (review) => (
        <span className="reviews-page__stars">
          <Star size={15} fill="currentColor" />
          {review.rating}
        </span>
      ),
      sortable: true,
      width: 90,
    },
    {
      id: "status",
      header: "Статус",
      value: (review) => review.status,
      cell: (review) => (
        <AppBadge tone={statusTones[review.status]}>{statusLabels[review.status]}</AppBadge>
      ),
      width: 150,
    },
    {
      id: "verified",
      header: "Подтверждение",
      value: (review) => (review.verified ? "verified" : "regular"),
      cell: (review) =>
        review.verified ? (
          <AppBadge tone="green">Подтверждённый</AppBadge>
        ) : (
          <AppBadge>Обычный</AppBadge>
        ),
      width: 160,
    },
    {
      id: "date",
      header: "Дата",
      value: (review) => review.createdAt,
      cell: (review) => formatDate(review.createdAt),
      sortable: true,
      width: 120,
    },
    {
      id: "actions",
      header: "",
      cell: (review) => <AppActionMenu actions={reviewActions(review)} />,
      width: 72,
    },
  ];

  return (
    <AdminPage title="Отзывы">
      <div className="reviews-page__metrics">
        <MetricCard icon={<MessageSquare />} label="На странице" value={reviews.length} />
        <MetricCard icon={<ShieldCheck />} label="Подтверждённые" value={metrics.verified} accent />
        <MetricCard icon={<Star />} label="На модерации" value={metrics.pending} />
      </div>

      <DataPanel
        title="Отзывы клиентов"
        actions={
          <SegmentedControl
            value={status}
            onValueChange={(value) => {
              setStatus(value as ReviewStatus | "ALL");
              setPage(1);
            }}
            items={[
              { value: "ALL", label: "Все" },
              { value: "PENDING", label: "Модерация" },
              { value: "APPROVED", label: "Опубликованы" },
              { value: "REJECTED", label: "Отклонены" },
              { value: "HIDDEN", label: "Скрыты" },
            ]}
          />
        }
      >
        <AppDataTable
          data={reviews}
          columns={columns}
          rowId={(review) => String(review.id)}
          onRowContextMenu={openReviewContextMenu}
          loading={reviewsQuery.isLoading}
          error={reviewsQuery.isError ? "Не удалось загрузить отзывы" : undefined}
          searchable
          mode="server"
          page={page}
          pageSize={10}
          totalItems={reviewsQuery.data?.totalItems ?? 0}
          totalPages={reviewsQuery.data?.totalPages ?? 1}
          onPageChange={setPage}
          emptyTitle="Отзывов нет"
          emptyDescription="Когда клиенты начнут оставлять отзывы, они появятся в этой таблице."
        />
      </DataPanel>
      <AppContextMenu
        open={Boolean(reviewContextMenu)}
        x={reviewContextMenu?.x ?? 0}
        y={reviewContextMenu?.y ?? 0}
        label={
          reviewContextMenu
            ? `Действия с отзывом: ${reviewContextMenu.review.productName}`
            : "Действия с отзывом"
        }
        actions={reviewContextMenu ? reviewActions(reviewContextMenu.review) : []}
        onOpenChange={(open) => {
          if (!open) setReviewContextMenu(null);
        }}
      />

      {selected ? (
        <DataPanel title="Переписка по отзыву">
          <div className="reviews-page__detail">
            <div className="reviews-page__review">
              <div>
                <strong>{selected.authorName}</strong>
                <span>{selected.productName}</span>
              </div>
              <p>{selected.content}</p>
              <div className="reviews-page__badges">
                <AppBadge tone={statusTones[selected.status]}>
                  {statusLabels[selected.status]}
                </AppBadge>
                {selected.verified && <AppBadge tone="green">Подтверждённый</AppBadge>}
              </div>
            </div>
            <div className="reviews-page__thread">
              {selected.messages.length > 0 ? (
                selected.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`reviews-page__message ${message.authorType.toLowerCase()}`}
                  >
                    <b>{message.authorType === "ADMIN" ? "Администратор" : message.authorName}</b>
                    <span>{formatDate(message.createdAt)}</span>
                    <p>{message.content}</p>
                  </div>
                ))
              ) : (
                <AppAlert title="Ответов пока нет">
                  Первый ответ администратора откроет клиенту возможность продолжить общение.
                </AppAlert>
              )}
            </div>
            <div className="reviews-page__reply">
              <AppTextarea
                label="Ответ администратора"
                value={reply}
                rows={3}
                onChange={(event) => setReply(event.target.value)}
              />
              <AppButton
                type="button"
                disabled={reply.trim().length < 2}
                loading={replyMutation.isPending}
                onClick={() => replyMutation.mutate()}
              >
                <MessageSquare size={16} />
                Ответить
              </AppButton>
            </div>
          </div>
        </DataPanel>
      ) : null}
    </AdminPage>
  );
}
