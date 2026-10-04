import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Boxes, Eye, ShoppingCart } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/shared/api/http";
import { formatDateTime, todayInAlmaty } from "@/shared/lib/dateTime";
import {
  DashboardAuditItem,
  DashboardData,
  DeploymentLog,
  DeploymentStatus,
} from "@/shared/types/models";
import { AdminPage } from "@/layouts/AdminPage";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppChart, AppChartTooltip, appChartColors } from "@/shared/ui/AppChart";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { AppTable } from "@/shared/ui/AppTable";
import "./DashboardPage.css";

type DashboardPeriod = 7 | 30 | 90;
type SalesMetric = "revenue" | "profit";

const periodItems = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
];

const salesMetricItems = [
  { value: "revenue", label: "Выручка" },
  { value: "profit", label: "Чистая прибыль" },
];

function formatMoney(value: number) {
  return `${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 0 }).format(value)} ₸`;
}

function formatTrend(value?: number) {
  if (value === undefined || value === null) return undefined;
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("ru-KZ", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate(),
  ).padStart(2, "0")}`;
}

function auditHref(item: DashboardAuditItem) {
  if (!item.entityId) return undefined;
  if (item.entityType === "PRODUCT") return `/admin/products/${item.entityId}`;
  if (item.entityType === "CATEGORY") return `/admin/categories/${item.entityId}`;
  if (item.entityType === "ORDER") return `/admin/orders/${item.entityId}`;
  if (item.entityType === "USER") return `/admin/users/${item.entityId}`;
  return undefined;
}

const deploymentStateLabels: Record<DeploymentStatus["state"], string> = {
  idle: "Ожидание",
  running: "Сборка выполняется",
  succeeded: "Успешно",
  failed: "Ошибка",
  unavailable: "Недоступно",
};

const deploymentStateTones: Record<DeploymentStatus["state"], "slate" | "blue" | "green" | "red"> =
  {
    idle: "slate",
    running: "blue",
    succeeded: "green",
    failed: "red",
    unavailable: "slate",
  };

function shortRevision(revision: string | null) {
  return revision ? revision.slice(0, 12) : "—";
}

type DeploymentLogTone = "stage" | "error" | "warning" | "success";
const MAX_VISIBLE_LOG_LINES = 2_000;

const deploymentStageLabels: Record<string, string> = {
  preparing: "Подготовка развёртывания",
  shared_services: "Обновление общих сервисов",
  embedding: "Обновление сервиса эмбеддингов",
  backend_build: "Сборка backend",
  frontend_build: "Сборка frontend",
  candidate: "Запуск новой версии",
  health: "Проверка работоспособности",
  switch: "Переключение трафика",
  drain: "Завершение запросов старой версии",
  cleanup: "Очистка старой версии и образов",
  nginx: "Обновление конфигурации Nginx",
  completed: "Развёртывание завершено",
};

function classifyDeploymentLogLine(line: string): {
  text: string;
  tone?: DeploymentLogTone;
  label?: string;
} {
  const text = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
  const stage = text.match(/^::company-shop-stage::([a-z_]+)$/);
  if (stage) {
    return { text: deploymentStageLabels[stage[1]] ?? stage[1], tone: "stage", label: "Этап" };
  }
  if (
    /\b(?:error|fatal|failed|failure|exception)\b/i.test(text) &&
    !/\b(?:0 errors?|no errors?)\b/i.test(text)
  ) {
    return { text, tone: "error", label: "Ошибка" };
  }
  if (/\b(?:warn|warning|deprecated|deprecation)\b/i.test(text)) {
    return { text, tone: "warning", label: "Внимание" };
  }
  if (
    /^(?:Deployment of [a-f0-9]+ succeeded\.|Deployed [a-f0-9]+\b)|\bBUILD SUCCESS(?:FUL)?\b/i.test(
      text,
    )
  ) {
    return { text, tone: "success", label: "Готово" };
  }
  return { text };
}

function DeploymentStatusPanel() {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const [followLog, setFollowLog] = useState(true);
  const [expandedLog, setExpandedLog] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const deployment = useQuery({
    queryKey: ["deployment-status"],
    queryFn: () => api<DeploymentStatus>("/api/admin/deployments/status"),
    refetchInterval: (query) => (query.state.data?.state === "running" ? 3_000 : 15_000),
    retry: false,
  });
  const status = deployment.data;
  const activeAttemptId = status?.attemptId ?? null;
  const visibleAttemptId =
    selectedAttemptId ?? activeAttemptId ?? status?.history[0]?.attemptId ?? null;
  const visibleHistoryItem = status?.history.find((item) => item.attemptId === visibleAttemptId);
  const viewingActiveAttempt = visibleAttemptId !== null && visibleAttemptId === activeAttemptId;
  const log = useQuery({
    queryKey: ["deployment-log", visibleAttemptId],
    queryFn: () =>
      api<DeploymentLog>(`/api/admin/deployments/logs/${encodeURIComponent(visibleAttemptId!)}`),
    enabled: visibleAttemptId !== null,
    refetchInterval: viewingActiveAttempt && status?.state === "running" ? 2_000 : false,
    retry: false,
  });
  const visibleLog = useMemo(() => {
    const lines = log.data?.text ? log.data.text.replace(/\n$/, "").split("\n") : [];
    return {
      omitted: Math.max(0, lines.length - MAX_VISIBLE_LOG_LINES),
      lines: lines.slice(-MAX_VISIBLE_LOG_LINES).map(classifyDeploymentLogLine),
    };
  }, [log.data?.text]);
  useEffect(() => {
    if (followLog && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [expandedLog, followLog, log.data?.text, visibleAttemptId]);

  function showAttempt(attemptId: string) {
    setSelectedAttemptId(attemptId);
    setFollowLog(true);
    consoleRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const checkedAtTime = status?.checkedAt ? Date.parse(status.checkedAt) : NaN;
  const runningStatusMayBeStale =
    status?.state === "running" &&
    Number.isFinite(checkedAtTime) &&
    Date.now() - checkedAtTime > 15 * 60_000;

  return (
    <DataPanel size="compact" title="Сборка обновлений" className="dashboard-page__deployments">
      {deployment.isPending ? (
        <div
          className="dashboard-page__panel-loading"
          role="status"
          aria-label="Загрузка статуса сборок"
        >
          <AppSkeleton />
        </div>
      ) : deployment.isError ? (
        <div className="dashboard-page__deployment-error">
          <AppBadge tone="slate">Недоступно</AppBadge>
          <AppAlert
            title="Не удалось проверить сборки"
            tone="danger"
            onRetry={() => deployment.refetch()}
          >
            Проверьте соединение с API и повторите попытку.
          </AppAlert>
        </div>
      ) : status ? (
        <>
          <div className="dashboard-page__deployment-summary">
            <div className="dashboard-page__deployment-detail">
              <span>Текущий статус</span>
              <AppBadge tone={deploymentStateTones[status.state]} role="status">
                {deploymentStateLabels[status.state]}
              </AppBadge>
            </div>
            <div className="dashboard-page__deployment-detail">
              <span>Развёрнутая ревизия</span>
              <code title={status.deployedRevision ?? undefined}>
                {shortRevision(status.deployedRevision)}
              </code>
            </div>
            <div className="dashboard-page__deployment-detail">
              <span>Целевая ревизия</span>
              <code title={status.targetRevision ?? undefined}>
                {shortRevision(status.targetRevision)}
              </code>
            </div>
            <div className="dashboard-page__deployment-detail">
              <span>Последняя проверка</span>
              <strong>{formatDateTime(status.checkedAt)}</strong>
            </div>
            {status.startedAt && (
              <div className="dashboard-page__deployment-detail">
                <span>Начало сборки</span>
                <strong>{formatDateTime(status.startedAt)}</strong>
              </div>
            )}
            {status.finishedAt && (
              <div className="dashboard-page__deployment-detail">
                <span>Завершение сборки</span>
                <strong>{formatDateTime(status.finishedAt)}</strong>
              </div>
            )}
          </div>
          {runningStatusMayBeStale && (
            <div className="dashboard-page__deployment-warning">
              <AppAlert title="Данные могли устареть" tone="warning">
                Сборка всё ещё отмечена как выполняющаяся, но проверка не обновлялась более 15
                минут.
              </AppAlert>
            </div>
          )}
          <div className="dashboard-page__deployment-console" ref={consoleRef}>
            <div className="dashboard-page__deployment-console-heading">
              <div>
                <h3>Консоль сборки</h3>
                <p role="status">
                  {viewingActiveAttempt
                    ? status.stage ||
                      (status.state === "running"
                        ? "Подготовка сборки"
                        : deploymentStateLabels[status.state])
                    : visibleHistoryItem
                      ? `${deploymentStateLabels[visibleHistoryItem.state]} · ${shortRevision(visibleHistoryItem.revision)}`
                      : "Вывод последней попытки"}
                </p>
              </div>
              {visibleAttemptId && (
                <div className="dashboard-page__deployment-console-actions">
                  {selectedAttemptId &&
                    activeAttemptId &&
                    selectedAttemptId !== activeAttemptId && (
                      <AppButton
                        variant="ghost"
                        type="button"
                        onClick={() => showAttempt(activeAttemptId)}
                      >
                        Текущая попытка
                      </AppButton>
                    )}
                  <AppButton variant="ghost" type="button" onClick={() => log.refetch()}>
                    Обновить
                  </AppButton>
                  <AppButton
                    variant="ghost"
                    type="button"
                    aria-expanded={expandedLog}
                    aria-controls="deployment-log-output"
                    onClick={() => setExpandedLog((expanded) => !expanded)}
                  >
                    {expandedLog ? "Свернуть" : "Развернуть"}
                  </AppButton>
                  {!followLog && (
                    <AppButton variant="ghost" type="button" onClick={() => setFollowLog(true)}>
                      К концу
                    </AppButton>
                  )}
                </div>
              )}
            </div>
            {visibleAttemptId ? (
              <>
                {log.data?.truncated && (
                  <p className="dashboard-page__deployment-log-note">
                    Показана последняя часть лога.
                  </p>
                )}
                {visibleLog.omitted > 0 && (
                  <p className="dashboard-page__deployment-log-note">
                    Скрыто более ранних строк: {visibleLog.omitted}.
                  </p>
                )}
                <div
                  className={`dashboard-page__deployment-log${expandedLog ? " dashboard-page__deployment-log--expanded" : ""}`}
                  id="deployment-log-output"
                  ref={logRef}
                  role="log"
                  aria-live="off"
                  aria-label="Вывод сборки"
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    setFollowLog(
                      element.scrollHeight - element.scrollTop - element.clientHeight < 40,
                    );
                  }}
                >
                  {log.isPending || log.isError || !log.data?.text ? (
                    <span className="dashboard-page__deployment-log-placeholder">
                      {log.isPending
                        ? "Загрузка вывода…"
                        : log.isError
                          ? "Не удалось загрузить лог. Повторите попытку."
                          : "Ожидание вывода сборки…"}
                    </span>
                  ) : (
                    visibleLog.lines.map((line, index) => (
                      <div
                        className={`dashboard-page__deployment-log-line${line.tone ? ` dashboard-page__deployment-log-line--${line.tone}` : ""}`}
                        key={index}
                      >
                        {line.tone && (
                          <span
                            className={`dashboard-page__deployment-log-tag dashboard-page__deployment-log-tag--${line.tone}`}
                          >
                            {line.label}
                          </span>
                        )}
                        <span>{line.text || "\u00a0"}</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <p className="dashboard-page__deployment-empty">Логов сборки пока нет.</p>
            )}
          </div>
          <div className="dashboard-page__deployment-history">
            <h3>Последние завершённые попытки</h3>
            {status.history.length ? (
              <AppTable
                size="compact"
                className="dashboard-page__deployment-table"
                headers={["Ревизия", "Результат", "Начало", "Завершение", "Лог"]}
                rows={status.history.slice(0, 10).map((item) => [
                  <code title={item.revision}>{shortRevision(item.revision)}</code>,
                  <AppBadge tone={deploymentStateTones[item.state]}>
                    {deploymentStateLabels[item.state]}
                  </AppBadge>,
                  formatDateTime(item.startedAt),
                  formatDateTime(item.finishedAt),
                  item.attemptId ? (
                    <AppButton
                      variant="ghost"
                      type="button"
                      aria-label={`Показать лог сборки ${shortRevision(item.revision)}`}
                      onClick={() => showAttempt(item.attemptId!)}
                    >
                      Смотреть
                    </AppButton>
                  ) : (
                    "—"
                  ),
                ])}
              />
            ) : (
              <p className="dashboard-page__deployment-empty">Завершённых попыток пока нет.</p>
            )}
          </div>
        </>
      ) : null}
    </DataPanel>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useCommerce();
  const [period, setPeriod] = useState<DashboardPeriod>(30);
  const [salesMetric, setSalesMetric] = useState<SalesMetric>("revenue");
  const dashboard = useQuery({
    queryKey: ["dashboard", period],
    queryFn: () => api<DashboardData>(`/api/admin/dashboard?period=${period}`),
  });
  const data = dashboard.data;
  const hasSelectedSalesMetric = data?.revenue.some((point) =>
    salesMetric === "profit" ? point.netProfit !== null : point.revenue > 0,
  );
  const chartDataKey = salesMetric === "profit" ? "netProfit" : "revenue";
  const chartLabel = salesMetric === "profit" ? "Чистая прибыль" : "Выручка";

  function openOrdersForDay(day: DashboardData["revenue"][number]) {
    const createdTo = period === 90 ? [addDays(day.key, 6), todayInAlmaty()].sort()[0] : day.key;
    const params = new URLSearchParams({ createdFrom: day.key, createdTo });
    navigate(`/admin/orders?${params.toString()}`);
  }

  return (
    <AdminPage
      title="Панель управления"
      actions={
        <div className="dashboard-page__heading-actions">
          {data && data.importErrors > 0 && (
            <AppBadge tone="red">Ошибки импорта ({data.importErrors})</AppBadge>
          )}
          <SegmentedControl
            items={periodItems}
            value={String(period)}
            onValueChange={(value) => setPeriod(Number(value) as DashboardPeriod)}
          />
        </div>
      }
    >
      {dashboard.isError ? (
        <AppAlert
          title="Не удалось загрузить дашборд"
          tone="danger"
          onRetry={() => dashboard.refetch()}
        >
          Проверьте соединение с API и повторите попытку.
        </AppAlert>
      ) : (
        <>
          <div className="metric-grid dashboard-page__metrics">
            <MetricCard
              icon={<ShoppingCart size={18} />}
              label="Новые заказы"
              value={data?.newOrders.value ?? 0}
              trend={formatTrend(data?.newOrders.trendPercent)}
              size="compact"
            />
            <MetricCard
              icon={<Boxes size={18} />}
              label="Товары в каталоге"
              value={data?.activeProducts ?? 0}
              accent
              size="compact"
            />
            <MetricCard
              icon={<Activity size={18} />}
              label="Категории"
              value={data?.activeCategories ?? 0}
              size="compact"
            />
            <MetricCard
              icon={<Eye size={18} />}
              label="Просмотры товаров"
              value={data?.productViews.value ?? 0}
              trend={formatTrend(data?.productViews.trendPercent)}
              size="compact"
              actions={
                <AppButton asChild variant="secondary">
                  <Link to="/admin/product-views">Подробнее</Link>
                </AppButton>
              }
            />
          </div>

          <div className="dashboard-page__main-grid">
            <DataPanel
              title="Динамика продаж"
              actions={
                <div className="dashboard-page__chart-actions">
                  <SegmentedControl
                    items={salesMetricItems}
                    value={salesMetric}
                    onValueChange={(value) => setSalesMetric(value as SalesMetric)}
                  />
                  <span className="mono-pill">последние {period} дней</span>
                </div>
              }
            >
              <div className="dashboard-page__chart">
                {dashboard.isLoading ? (
                  <AppSkeleton />
                ) : hasSelectedSalesMetric ? (
                  <AppChart
                    title={`Динамика продаж за ${period} дней`}
                    description={
                      salesMetric === "profit"
                        ? "Оплаченная цена продажи минус приходная цена товара. Период скрывается, если для хотя бы одной позиции нет приходной цены. Нажмите на столбец, чтобы открыть заказы за этот период."
                        : "Оплаченная выручка без отменённых и возвращённых заказов. Нажмите на столбец, чтобы открыть заказы за этот день."
                    }
                    height={300}
                  >
                    <BarChart
                      data={data?.revenue ?? []}
                      margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
                    >
                      <CartesianGrid strokeDasharray="4 4" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={72}
                        tickFormatter={(value) =>
                          new Intl.NumberFormat("ru-KZ", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(Number(value))
                        }
                      />
                      <AppChartTooltip
                        formatter={(value, name) => [
                          formatMoney(Number(value)),
                          name === chartLabel ? chartLabel : name,
                        ]}
                      />
                      <Bar
                        dataKey={chartDataKey}
                        name={chartLabel}
                        className="dashboard-page__sales-bar"
                        fill={
                          salesMetric === "profit" ? appChartColors.green : appChartColors.orange
                        }
                        radius={[5, 5, 0, 0]}
                        onClick={(entry) => {
                          const day = entry?.payload as
                            | DashboardData["revenue"][number]
                            | undefined;
                          if (day?.key) openOrdersForDay(day);
                        }}
                      />
                    </BarChart>
                  </AppChart>
                ) : (
                  <div className="dashboard-page__empty">
                    <b>
                      {salesMetric === "profit"
                        ? "Недостаточно приходных цен"
                        : "Продаж за период нет"}
                    </b>
                    <span>
                      {salesMetric === "profit"
                        ? "Добавьте приходные цены товарам: после оплаты заказа появится чистая прибыль."
                        : "График появится после первого оплаченного заказа."}
                    </span>
                  </div>
                )}
              </div>
            </DataPanel>

            <DataPanel className="dashboard-page__quick-actions" title="Быстрые действия">
              <div className="dashboard-page__quick-list">
                <AppButton asChild>
                  <Link to="/admin/products/new">Добавить товар</Link>
                </AppButton>
                <AppButton asChild variant="secondary">
                  <Link to="/admin/external-software">Импорт данных</Link>
                </AppButton>
                <AppButton asChild variant="secondary">
                  <Link to="/admin/orders">Заказы</Link>
                </AppButton>
              </div>
            </DataPanel>
          </div>

          <div className="dashboard-page__tables">
            <DataPanel size="compact" title="Новые товары">
              {dashboard.isLoading ? (
                <div className="dashboard-page__panel-loading">
                  <AppSkeleton />
                </div>
              ) : data?.recentProducts.length ? (
                <AppTable
                  size="compact"
                  className="dashboard-page__products-table"
                  headers={["Артикул", "Название", "Цена", "Статус"]}
                  rows={data.recentProducts.map((product) => [
                    <Link to={`/admin/products/${product.id}`}>
                      <code>{product.sku}</code>
                    </Link>,
                    <Link to={`/admin/products/${product.id}`}>{product.name}</Link>,
                    formatMoney(product.price),
                    <AppBadge tone={product.active ? "green" : "slate"}>
                      {product.active ? "Активен" : "Скрыт"}
                    </AppBadge>,
                  ])}
                />
              ) : (
                <div className="dashboard-page__empty dashboard-page__empty--small">
                  <b>Товаров пока нет</b>
                </div>
              )}
            </DataPanel>

            <DataPanel size="compact" title="Действия пользователей">
              {dashboard.isLoading ? (
                <div className="dashboard-page__panel-loading">
                  <AppSkeleton />
                </div>
              ) : data?.recentActions.length ? (
                <AppTable
                  size="compact"
                  className="dashboard-page__actions-table"
                  headers={["Время", "Сотрудник", "Действие"]}
                  rows={data.recentActions.map((item) => {
                    const href = auditHref(item);
                    const description = href ? (
                      <Link to={href}>{item.description}</Link>
                    ) : (
                      item.description
                    );
                    return [
                      formatDateTime(item.createdAt, {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                      item.actorName,
                      description,
                    ];
                  })}
                />
              ) : (
                <div className="dashboard-page__empty dashboard-page__empty--small">
                  <b>Действий пока нет</b>
                </div>
              )}
            </DataPanel>
          </div>
        </>
      )}
      {user?.permissions.includes("deployments.read") && <DeploymentStatusPanel />}
    </AdminPage>
  );
}
