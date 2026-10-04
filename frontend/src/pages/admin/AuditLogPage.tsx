import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileText, History, UserRound } from "lucide-react";
import { AdminPage } from "@/layouts/AdminPage";
import { api } from "@/shared/api/http";
import { ALMATY_TIME_ZONE, formatDateTime } from "@/shared/lib/dateTime";
import { AuditLog, PagedResult } from "@/shared/types/models";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppDatePicker } from "@/shared/ui/AppDatePicker";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./AuditLogPage.css";

const actionLabels: Record<string, string> = {
  CREATE: "Создание",
  UPDATE: "Изменение",
  DELETE: "Удаление",
  SOFT_DELETE: "Скрытие",
  SELECT: "Выбор",
  UNSELECT: "Снятие выбора",
  ORDER_COPY: "Копирование заказа",
};

const entityLabels: Record<string, string> = {
  PRODUCT: "Товар",
  CATEGORY: "Категория",
  ORDER: "Заказ",
  PROCUREMENT_PROJECT: "Проект закупки",
  PROCUREMENT_COMPANY: "Компания",
  PROCUREMENT_COMPANY_NOTE: "Заметка компании",
  PROCUREMENT_FILE: "Файл закупки",
  PROCUREMENT_PAYMENT: "Оплата закупки",
};

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: ALMATY_TIME_ZONE });

function toDateKey(value?: Date) {
  return value ? dateKeyFormat.format(value) : "";
}

function actionTone(action: string): "green" | "orange" | "red" | "slate" {
  if (action === "CREATE") return "green";
  if (action.includes("DELETE")) return "red";
  if (action === "UPDATE") return "orange";
  return "slate";
}

function actionLabel(action: string) {
  return actionLabels[action] ?? action.replace(/_/g, " ");
}

function entityLabel(entityType: string) {
  return entityLabels[entityType] ?? entityType.replace(/_/g, " ");
}

export function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState<Date>();
  const [toDate, setToDate] = useState<Date>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const from = toDateKey(fromDate);
  const to = toDateKey(toDate);
  const invalidPeriod = Boolean(from && to && from > to);

  const auditQuery = useQuery({
    queryKey: ["audit-logs", search, from, to, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), size: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return api<PagedResult<AuditLog>>(`/api/admin/audit-logs?${params}`);
    },
    enabled: !invalidPeriod,
  });
  const logs = auditQuery.data?.items ?? [];
  const actorCount = useMemo(
    () => new Set(logs.map((log) => log.actorUserId ?? log.actorName)).size,
    [logs],
  );

  const columns: AppDataTableColumn<AuditLog>[] = [
    {
      id: "createdAt",
      header: "Когда",
      value: (log) => log.createdAt,
      width: 176,
      cell: (log) => <time>{formatDateTime(log.createdAt)}</time>,
    },
    {
      id: "actorName",
      header: "Пользователь",
      value: (log) => log.actorName,
      width: 190,
      cell: (log) => (
        <div className="audit-log-page__actor">
          <strong>{log.actorName || "Система"}</strong>
          {log.actorUserId ? <span>ID: {log.actorUserId}</span> : <span>Системное действие</span>}
        </div>
      ),
    },
    {
      id: "action",
      header: "Действие",
      value: (log) => actionLabel(log.action),
      width: 178,
      cell: (log) => <AppBadge tone={actionTone(log.action)}>{actionLabel(log.action)}</AppBadge>,
    },
    {
      id: "entityType",
      header: "Раздел",
      value: (log) => `${entityLabel(log.entityType)} ${log.entityId ?? ""}`,
      width: 190,
      cell: (log) => (
        <div className="audit-log-page__entity">
          <span>{entityLabel(log.entityType)}</span>
          {log.entityId ? <code>ID: {log.entityId}</code> : null}
        </div>
      ),
    },
    {
      id: "description",
      header: "Подробности",
      accessor: "description",
      cell: (log) => <span className="audit-log-page__description">{log.description}</span>,
    },
  ];

  return (
    <AdminPage eyebrow="Администрирование" title="Журнал действий">
      <div className="metric-grid audit-log-page__metrics">
        <MetricCard
          icon={<History size={18} />}
          label="Всего событий"
          value={auditQuery.data?.totalItems ?? 0}
          size="compact"
        />
        <MetricCard
          icon={<Activity size={18} />}
          label="На этой странице"
          value={logs.length}
          size="compact"
          accent
        />
        <MetricCard
          icon={<UserRound size={18} />}
          label="Инициаторов на странице"
          value={actorCount}
          size="compact"
        />
        <MetricCard
          icon={<FileText size={18} />}
          label="Поиск"
          value={search.trim() ? "Включён" : "Все записи"}
          size="compact"
        />
      </div>

      <section className="data-panel audit-log-page__panel">
        <AppDataTable
          className="audit-log-page__table"
          data={logs}
          columns={columns}
          rowId={(log) => String(log.id)}
          loading={auditQuery.isLoading}
          error={auditQuery.isError ? "Не удалось загрузить журнал действий" : undefined}
          mode="server"
          searchable
          selectable={false}
          searchValue={search}
          onSearchChange={setSearch}
          toolbarFilters={
            <>
              <div className="audit-log-page__date-filter">
                <AppDatePicker
                  value={fromDate}
                  placeholder="Дата от"
                  onValueChange={(value) => {
                    setFromDate(value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="audit-log-page__date-filter">
                <AppDatePicker
                  value={toDate}
                  placeholder="Дата до"
                  error={invalidPeriod ? "Дата окончания раньше даты начала" : undefined}
                  onValueChange={(value) => {
                    setToDate(value);
                    setPage(1);
                  }}
                />
              </div>
            </>
          }
          activeToolbarFilters={Number(Boolean(from)) + Number(Boolean(to))}
          onClearToolbarFilters={() => {
            setFromDate(undefined);
            setToDate(undefined);
          }}
          page={auditQuery.data?.page ?? page}
          pageSize={auditQuery.data?.size ?? pageSize}
          totalItems={auditQuery.data?.totalItems ?? 0}
          totalPages={auditQuery.data?.totalPages ?? 1}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizes={[25, 50, 100]}
          emptyTitle="Действий пока нет"
          emptyDescription="После выполнения операций пользователями события появятся в журнале."
        />
      </section>
    </AdminPage>
  );
}
