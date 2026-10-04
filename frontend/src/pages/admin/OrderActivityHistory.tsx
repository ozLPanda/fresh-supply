import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchOrderActivity,
  fetchOrderActivityFilterOptions,
  type OrderActivity,
  type OrderActivityCategory,
  type OrderActivityFilterOptions,
} from "@/shared/api/orders";
import { ActivityChanges } from "@/shared/components/activity/ActivityChanges";
import { ALMATY_TIME_ZONE, formatDateTime } from "@/shared/lib/dateTime";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppDateRangePicker, type AppDateRange } from "@/shared/ui/AppDatePicker";
import { AppSelect } from "@/shared/ui/AppField";
import "./OrderActivityHistory.css";

const categoryLabels: Record<OrderActivityCategory, string> = {
  ORDER_CHANGE: "Изменения заказа",
  FULFILLMENT: "Сборка",
  PAYMENT: "Оплата",
};
const actionLabels: Record<string, string> = {
  CREATE: "Создание",
  STATUS_CHANGE: "Изменение статуса",
  PRICE_REVIEW: "Актуализация цен",
  UPDATE: "Обновление",
  PAYMENT: "Подтверждение оплаты",
  SOFT_DELETE: "Удаление",
};
const dateKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: ALMATY_TIME_ZONE });

function toDateKey(value?: Date) {
  return value ? dateKeyFormat.format(value) : "";
}

function categoryTone(category: OrderActivityCategory): "orange" | "blue" | "green" {
  if (category === "PAYMENT") return "green";
  if (category === "FULFILLMENT") return "blue";
  return "orange";
}

function actionLabel(action: string, options: OrderActivityFilterOptions["actions"]) {
  return (
    options.find((option) => option.value === action)?.label ??
    actionLabels[action] ??
    action.replace(/_/g, " ")
  );
}

export function OrderActivityHistory({ orderId }: { orderId: string }) {
  const [actorUserId, setActorUserId] = useState("");
  const [period, setPeriod] = useState<AppDateRange>();
  const [categories, setCategories] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const from = toDateKey(period?.from);
  const to = toDateKey(period?.to);
  const invalidPeriod = Boolean(from && to && from > to);
  const filterOptions = useQuery({
    queryKey: ["order-activity-filter-options", orderId],
    queryFn: () => fetchOrderActivityFilterOptions(orderId),
  });
  const activities = useQuery({
    queryKey: [
      "order-activity",
      orderId,
      actorUserId,
      from,
      to,
      categories,
      actions,
      page,
      pageSize,
    ],
    queryFn: () =>
      fetchOrderActivity(orderId, {
        actorUserId,
        from,
        to,
        categories: categories.join(","),
        actions: actions.join(","),
        page,
        size: pageSize,
      }),
    enabled: !invalidPeriod,
  });
  const availableActions = useMemo(
    () =>
      (filterOptions.data?.actions ?? []).filter(
        (option) => categories.length === 0 || categories.includes(option.category),
      ),
    [categories, filterOptions.data?.actions],
  );
  const availableCategories = useMemo(
    () =>
      Object.entries(categoryLabels).filter(([category]) =>
        (filterOptions.data?.actions ?? []).some((option) => option.category === category),
      ),
    [filterOptions.data?.actions],
  );
  const columns: AppDataTableColumn<OrderActivity>[] = [
    {
      id: "occurredAt",
      header: "Когда",
      value: (activity) => activity.occurredAt,
      width: 168,
      cell: (activity) => <time>{formatDateTime(activity.occurredAt)}</time>,
    },
    {
      id: "actorName",
      header: "Администратор",
      value: (activity) => activity.actorName ?? "Система",
      width: 190,
      cell: (activity) => activity.actorName || "Система",
    },
    {
      id: "category",
      header: "Раздел",
      value: (activity) => categoryLabels[activity.category],
      width: 180,
      cell: (activity) => (
        <AppBadge tone={categoryTone(activity.category)}>
          {categoryLabels[activity.category]}
        </AppBadge>
      ),
    },
    {
      id: "action",
      header: "Действие",
      value: (activity) => actionLabel(activity.action, filterOptions.data?.actions ?? []),
      width: 190,
      cell: (activity) => actionLabel(activity.action, filterOptions.data?.actions ?? []),
    },
    {
      id: "description",
      header: "Подробности",
      accessor: "description",
      cell: (activity) =>
        activity.changes.length ? (
          <ActivityChanges changes={activity.changes} />
        ) : (
          activity.description
        ),
    },
  ];
  const activeFilters =
    Number(Boolean(actorUserId)) + Number(Boolean(from || to)) + categories.length + actions.length;

  return (
    <section className="order-activity-history" aria-label="История изменений заказа">
      <AppDataTable
        data={activities.data?.items ?? []}
        columns={columns}
        rowId={(activity) => activity.id}
        loading={activities.isLoading || filterOptions.isLoading}
        error={
          activities.isError || filterOptions.isError
            ? "Не удалось загрузить историю изменений"
            : undefined
        }
        mode="server"
        searchable={false}
        selectable={false}
        toolbarFilters={
          <div className="order-activity-history__filters">
            <AppSelect
              options={(filterOptions.data?.users ?? []).map((user) => ({
                value: String(user.id),
                label: user.name,
              }))}
              value={actorUserId}
              placeholder="Все администраторы"
              ariaLabel="Администратор"
              clearable
              onValueChange={(value) => {
                setActorUserId(typeof value === "string" ? value : "");
                setPage(1);
              }}
            />
            <AppDateRangePicker
              value={period}
              error={invalidPeriod ? "Проверьте диапазон дат" : undefined}
              onValueChange={(value) => {
                setPeriod(value);
                setPage(1);
              }}
            />
            <AppSelect
              options={availableCategories.map(([value, label]) => ({ value, label }))}
              value={categories}
              multiple
              showSelectedTags={false}
              multipleValueDisplay="count"
              placeholder="Все действия"
              ariaLabel="Тип действия"
              onValueChange={(value) => {
                setCategories(Array.isArray(value) ? value : []);
                setActions([]);
                setPage(1);
              }}
            />
            {availableActions.length > 0 && (
              <AppSelect
                options={availableActions.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={actions}
                multiple
                showSelectedTags={false}
                multipleValueDisplay="count"
                placeholder="Все операции"
                ariaLabel="Операция"
                onValueChange={(value) => {
                  setActions(Array.isArray(value) ? value : []);
                  setPage(1);
                }}
              />
            )}
          </div>
        }
        activeToolbarFilters={activeFilters}
        onClearToolbarFilters={() => {
          setActorUserId("");
          setPeriod(undefined);
          setCategories([]);
          setActions([]);
          setPage(1);
        }}
        page={activities.data?.page ?? page}
        pageSize={activities.data?.size ?? pageSize}
        totalItems={activities.data?.totalItems ?? 0}
        totalPages={activities.data?.totalPages ?? 1}
        onPageChange={setPage}
        onPageSizeChange={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
        }}
        pageSizes={[25, 50, 100]}
        emptyTitle="Изменений пока нет"
        emptyDescription="Здесь появятся изменения заказа, сборки и оплаты."
      />
    </section>
  );
}
