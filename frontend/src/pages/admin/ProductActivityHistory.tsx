import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchProductActivity,
  fetchProductActivityFilterOptions,
  type ProductActivity,
  type ProductActivityCategory,
} from "@/shared/api/catalog";
import { ALMATY_TIME_ZONE, formatDateTime } from "@/shared/lib/dateTime";
import { AppBadge } from "@/shared/ui/AppBadge";
import { ActivityChanges } from "@/shared/components/activity/ActivityChanges";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppDateRangePicker, type AppDateRange } from "@/shared/ui/AppDatePicker";
import { AppSelect } from "@/shared/ui/AppField";
import "./ProductActivityHistory.css";

const categoryLabels: Record<ProductActivityCategory, string> = {
  PRODUCT_CHANGE: "Изменения товара",
  DOCUMENT: "Документы",
  ORDER_FULFILLMENT: "Отпуск в заказах",
};

const actionLabels: Record<string, string> = {
  CREATE: "Создание",
  UPDATE: "Обновление",
  POST: "Проведение",
  CANCEL: "Отмена проведения",
  DELETE: "Удаление",
  SOFT_DELETE: "Скрытие",
  RESTORE: "Восстановление",
};

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: ALMATY_TIME_ZONE });

function toDateKey(value?: Date) {
  return value ? dateKeyFormat.format(value) : "";
}

function categoryTone(category: ProductActivityCategory): "orange" | "green" | "slate" {
  if (category === "PRODUCT_CHANGE") return "orange";
  if (category === "ORDER_FULFILLMENT") return "green";
  return "slate";
}

function sourceLabel(activity: ProductActivity) {
  if (activity.documentNumber) return activity.documentNumber;
  if (activity.orderId) return `Заказ №${activity.orderId}`;
  return "Карточка товара";
}

function actionLabel(action: string) {
  return actionLabels[action] ?? action.replace(/_/g, " ");
}

function availabilityTone(status: string): "green" | "orange" | "slate" | "red" {
  if (status === "В наличии") return "green";
  if (status === "Под заказ") return "orange";
  if (status === "Скрыт") return "red";
  return "slate";
}

function activityDetails(activity: ProductActivity) {
  if (activity.changes && activity.changes.length > 0) {
    return <ActivityChanges changes={activity.changes} />;
  }

  const status = activity.description.match(
    /^(?:Изменил доступность товара|Перевёл товар) «.*?» (?:на|в статус) «([^»]+)»(?: после анализа ключевых слов)?$/,
  )?.[1];
  if (!status) {
    if (activity.type === "PRODUCT" && activity.action === "UPDATE") {
      return <span className="product-activity-history__missing-details">Детали изменения не сохранены</span>;
    }
    return activity.description;
  }

  return (
    <span className="product-activity-history__availability">
      <AppBadge tone="blue">Доступность</AppBadge>
      <AppBadge tone={availabilityTone(status)}>{status}</AppBadge>
    </span>
  );
}

export function ProductActivityHistory({ productId }: { productId: number }) {
  const [actorUserId, setActorUserId] = useState("");
  const [period, setPeriod] = useState<AppDateRange>();
  const [categories, setCategories] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const from = toDateKey(period?.from);
  const to = toDateKey(period?.to);
  const invalidPeriod = Boolean(from && to && from > to);
  const filterOptions = useQuery({
    queryKey: ["product-activity-filter-options", productId],
    queryFn: () => fetchProductActivityFilterOptions(productId),
  });
  const activities = useQuery({
    queryKey: [
      "product-activity",
      productId,
      actorUserId,
      from,
      to,
      categories,
      types,
      page,
      pageSize,
    ],
    queryFn: () =>
      fetchProductActivity(productId, {
        actorUserId,
        from,
        to,
        categories: categories.join(","),
        types: types.join(","),
        page,
        size: pageSize,
      }),
    enabled: !invalidPeriod,
  });
  const availableTypes = useMemo(
    () =>
      (filterOptions.data?.types ?? []).filter(
        (option) => categories.length === 0 || categories.includes(option.category),
      ),
    [categories, filterOptions.data?.types],
  );
  const availableCategories = useMemo(
    () =>
      Object.entries(categoryLabels).filter(([category]) =>
        (filterOptions.data?.types ?? []).some((option) => option.category === category),
      ),
    [filterOptions.data?.types],
  );
  const columns: AppDataTableColumn<ProductActivity>[] = [
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
      value: (activity) => actionLabel(activity.action),
      width: 190,
      cell: (activity) => actionLabel(activity.action),
    },
    { id: "source", header: "Источник", value: sourceLabel, width: 190, cell: sourceLabel },
    {
      id: "description",
      header: "Подробности",
      accessor: "description",
      cell: activityDetails,
    },
  ];
  const activeFilters =
    Number(Boolean(actorUserId)) + Number(Boolean(from || to)) + categories.length + types.length;

  return (
    <section className="product-activity-history" aria-label="История операций с товаром">
      <AppDataTable
        data={activities.data?.items ?? []}
        columns={columns}
        rowId={(activity) => activity.id}
        loading={activities.isLoading || filterOptions.isLoading}
        error={
          activities.isError || filterOptions.isError
            ? "Не удалось загрузить историю операций"
            : undefined
        }
        mode="server"
        searchable={false}
        selectable={false}
        toolbarFilters={
          <div className="product-activity-history__filters">
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
                setTypes([]);
                setPage(1);
              }}
            />
            {availableTypes.length > 0 && (
              <AppSelect
                options={availableTypes.map((option) => ({
                  value: option.type,
                  label: option.label,
                }))}
                value={types}
                multiple
                showSelectedTags={false}
                multipleValueDisplay="count"
                placeholder="Все виды операций"
                ariaLabel="Вид документа или операции"
                onValueChange={(value) => {
                  setTypes(Array.isArray(value) ? value : []);
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
          setTypes([]);
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
        emptyTitle="Операций пока нет"
        emptyDescription="Здесь появятся изменения товара, документы и отпуск в заказах."
      />
    </section>
  );
}
