import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type SortingState, type VisibilityState } from "@tanstack/react-table";
import {
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Eye,
  Plus,
  ReceiptText,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { OrderAssistantModal } from "@/features/orders/OrderAssistantModal";
import { OrderCompletionFlow } from "@/features/orders/OrderCompletionFlow";
import { PRICE_TIER_LABELS, priceTierTone } from "@/features/orders/price-tier";
import { AdminPage } from "@/layouts/AdminPage";
import { api } from "@/shared/api/http";
import { formatDateTime } from "@/shared/lib/dateTime";
import { Order, OrderReturnStatistic, PagedResult } from "@/shared/types/models";
import { formatMoney } from "@/pages/public/store-utils";
import { orderStatusLabel, orderStatusTone } from "@/pages/customer/OrdersPage";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import {
  AppDataTable,
  type AppDataTableColumn,
  type AppDataTableDensity,
  type AppDataTableFilterValues,
} from "@/shared/ui/AppDataTable";
import { AppContextMenu, type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppDateRangePicker, type AppDateRange } from "@/shared/ui/AppDatePicker";
import { AppModal, AppTooltip } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./OrdersPage.css";

const ORDERS_TABLE_STATE_KEY = "admin-orders-table-state-v1";

type OrdersTableState = {
  search: string;
  page: number;
  pageSize: number;
  sorting: SortingState;
  filterValues: AppDataTableFilterValues;
  density: AppDataTableDensity;
  columnVisibility: VisibilityState;
  scrollY: number;
  tableScroll: { top: number; left: number };
  expandedOrderIds: string[];
};

type OrdersPageLocationState = {
  ordersTableState?: OrdersTableState;
};

const DEFAULT_ORDERS_TABLE_STATE: OrdersTableState = {
  search: "",
  page: 1,
  pageSize: 10,
  sorting: [],
  filterValues: {},
  density: "default",
  columnVisibility: {},
  scrollY: 0,
  tableScroll: { top: 0, left: 0 },
  expandedOrderIds: [],
};

function getOrdersTableState(): OrdersTableState {
  try {
    const saved = window.sessionStorage.getItem(ORDERS_TABLE_STATE_KEY);
    if (!saved) return DEFAULT_ORDERS_TABLE_STATE;
    const value = JSON.parse(saved) as Partial<OrdersTableState>;

    return {
      search: typeof value.search === "string" ? value.search : "",
      page: Number.isInteger(value.page) && value.page! > 0 ? value.page! : 1,
      pageSize: Number.isInteger(value.pageSize) && value.pageSize! > 0 ? value.pageSize! : 10,
      sorting: Array.isArray(value.sorting)
        ? value.sorting.filter(
            (item): item is { id: string; desc: boolean } =>
              typeof item?.id === "string" && typeof item.desc === "boolean",
          )
        : [],
      filterValues:
        value.filterValues && typeof value.filterValues === "object"
          ? Object.fromEntries(
              Object.entries(value.filterValues).filter(
                ([key, values]) =>
                  typeof key === "string" &&
                  Array.isArray(values) &&
                  values.every((item) => typeof item === "string"),
              ),
            )
          : {},
      density:
        value.density === "compact" || value.density === "comfortable" ? value.density : "default",
      columnVisibility:
        value.columnVisibility && typeof value.columnVisibility === "object"
          ? value.columnVisibility
          : {},
      scrollY:
        typeof value.scrollY === "number" && Number.isFinite(value.scrollY) && value.scrollY > 0
          ? value.scrollY
          : 0,
      expandedOrderIds: Array.isArray(value.expandedOrderIds)
        ? value.expandedOrderIds.filter((id): id is string => typeof id === "string")
        : [],
      tableScroll: {
        top:
          typeof value.tableScroll?.top === "number" && Number.isFinite(value.tableScroll.top)
            ? Math.max(0, value.tableScroll.top)
            : 0,
        left:
          typeof value.tableScroll?.left === "number" && Number.isFinite(value.tableScroll.left)
            ? Math.max(0, value.tableScroll.left)
            : 0,
      },
    };
  } catch {
    return DEFAULT_ORDERS_TABLE_STATE;
  }
}

function isDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate(),
  ).padStart(2, "0")}`;
}

function stockShortageQuantity(order: Order) {
  return order.items.reduce((total, item) => total + (item.stockShortageQuantity ?? 0), 0);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

const ORDER_STATUS_ACTION_ICONS = {
  NEW: <CircleDot size={17} />,
  PROCESSING: <Clock3 size={17} />,
  READY_FOR_PICKUP: <ClipboardCheck size={17} />,
  COMPLETED: <CheckCircle2 size={17} />,
  CANCELLED: <XCircle size={17} />,
} satisfies Partial<Record<Order["status"], ReactNode>>;

export function AdminOrdersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useCommerce();
  const queryClient = useQueryClient();
  const canCreateOrder = user?.permissions?.includes("orders.update") ?? false;
  const canUpdateOrders = user?.permissions?.includes("orders.update") ?? false;
  const canDeleteOrders = user?.permissions?.includes("orders.delete") ?? false;
  const canManageWarehouse = user?.permissions?.includes("warehouse.manage") ?? false;
  const initialState = useRef(
    (location.state as OrdersPageLocationState | null)?.ordersTableState ?? getOrdersTableState(),
  ).current;
  const [search, setSearch] = useState(initialState.search);
  const [page, setPage] = useState(initialState.page);
  const [pageSize, setPageSize] = useState(initialState.pageSize);
  const [sorting, setSorting] = useState<SortingState>(initialState.sorting);
  const [filterValues, setFilterValues] = useState<AppDataTableFilterValues>(
    initialState.filterValues,
  );
  const [density, setDensity] = useState<AppDataTableDensity>(initialState.density);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialState.columnVisibility,
  );
  const [expandedOrderIds, setExpandedOrderIds] = useState(initialState.expandedOrderIds ?? []);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [orderCompletionTarget, setOrderCompletionTarget] = useState<Order | null>(null);
  const [orderContextMenu, setOrderContextMenu] = useState<{
    order: Order;
    x: number;
    y: number;
  } | null>(null);
  const stateRef = useRef<OrdersTableState>(initialState);
  const tableScrollRef = useRef(initialState.tableScroll ?? { top: 0, left: 0 });
  const scrollRestoredRef = useRef(false);
  const tablePanelRef = useRef<HTMLDivElement>(null);
  const createdFrom = searchParams.get("createdFrom");
  const createdTo = searchParams.get("createdTo");
  const selectedPriceTiers = (filterValues.priceTier ?? []).map(
    (value) =>
      Object.entries(PRICE_TIER_LABELS).find(
        ([key, label]) => key === value || label === value,
      )?.[0] ?? value,
  );
  const stockShortageValues = filterValues.stockShortage ?? [];
  const stockShortage =
    stockShortageValues.length === 1 ? stockShortageValues[0] === "Есть" : undefined;
  const query = useQuery({
    queryKey: [
      "orders",
      "admin",
      "page",
      search,
      page,
      pageSize,
      sorting,
      filterValues,
      createdFrom,
      createdTo,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        size: String(pageSize),
        sort: sorting[0]?.id ?? "createdAt",
        direction: sorting[0]?.desc ? "desc" : sorting.length ? "asc" : "desc",
      });
      if (search.trim()) params.set("search", search.trim());
      if (isDateKey(createdFrom)) params.set("createdFrom", createdFrom);
      if (isDateKey(createdTo)) params.set("createdTo", createdTo);
      for (const status of filterValues.status ?? []) params.append("status", status);
      for (const tier of selectedPriceTiers) params.append("priceTier", tier);
      if (stockShortage !== undefined) params.set("stockShortage", String(stockShortage));
      return api<PagedResult<Order>>(`/api/admin/orders/page?${params.toString()}`);
    },
  });
  const summaryQuery = useQuery({
    queryKey: ["orders", "admin", "summary", createdFrom, createdTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (isDateKey(createdFrom)) params.set("createdFrom", createdFrom);
      if (isDateKey(createdTo)) params.set("createdTo", createdTo);
      return api<{ total: number; newOrders: number; processing: number; ready: number }>(
        `/api/admin/orders/summary?${params.toString()}`,
      );
    },
  });
  const returnStatisticsQuery = useQuery({
    queryKey: ["orders", "admin", "return-statistics"],
    queryFn: () => api<OrderReturnStatistic[]>("/api/admin/orders/return-statistics"),
  });
  const orders = query.data?.items ?? [];
  useEffect(() => {
    if (query.data && page > Math.max(query.data.totalPages, 1)) {
      setPage(Math.max(query.data.totalPages, 1));
    }
  }, [page, query.data]);
  const createdDateRange: AppDateRange | undefined =
    isDateKey(createdFrom) || isDateKey(createdTo)
      ? {
          from: isDateKey(createdFrom) ? dateFromKey(createdFrom) : dateFromKey(createdTo!),
          to: isDateKey(createdTo) ? dateFromKey(createdTo) : undefined,
        }
      : undefined;

  function setCreatedDateRange(range?: AppDateRange) {
    const next = new URLSearchParams(searchParams);
    const from = range?.from ? dateKey(range.from) : undefined;
    const to = range?.to ? dateKey(range.to) : undefined;
    if (from) next.set("createdFrom", from);
    else next.delete("createdFrom");
    if (to) next.set("createdTo", to);
    else next.delete("createdTo");
    setSearchParams(next);
    setPage(1);
  }
  stateRef.current = {
    search,
    page,
    pageSize,
    sorting,
    filterValues,
    density,
    columnVisibility,
    scrollY: window.scrollY,
    tableScroll: tableScrollRef.current,
    expandedOrderIds,
  };

  function captureTableState(): OrdersTableState {
    return {
      ...stateRef.current,
      scrollY: window.scrollY,
      tableScroll: { ...tableScrollRef.current },
    };
  }

  function persistTableState(state = captureTableState()) {
    try {
      window.sessionStorage.setItem(ORDERS_TABLE_STATE_KEY, JSON.stringify(state));
    } catch {
      // The current router entry also carries the snapshot when storage is unavailable.
    }
  }

  function openOrder(orderId: string) {
    const ordersTableState = captureTableState();
    persistTableState(ordersTableState);
    navigate(`/admin/orders/${orderId}`, {
      state: {
        returnTo: `${location.pathname}${location.search}${location.hash}`,
        returnState: { ordersTableState },
      },
    });
  }

  function handleOrderLinkClick(event: MouseEvent<HTMLAnchorElement>, orderId: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      return;
    event.preventDefault();
    openOrder(orderId);
  }

  function openCreateOrder(path: string) {
    const ordersTableState = captureTableState();
    persistTableState(ordersTableState);
    navigate(path, {
      state: {
        returnTo: `${location.pathname}${location.search}${location.hash}`,
        returnState: { ordersTableState },
      },
    });
  }

  useEffect(
    () => () => {
      persistTableState();
    },
    [],
  );

  useEffect(() => {
    if (
      scrollRestoredRef.current ||
      initialState.scrollY === 0 ||
      !query.isSuccess ||
      query.isFetching ||
      orders.length === 0
    ) {
      return;
    }

    const tablePanel = tablePanelRef.current;
    if (!tablePanel) return;

    const frame = window.requestAnimationFrame(() => {
      const documentHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      const maximumScrollY = Math.max(0, documentHeight - window.innerHeight);
      if (maximumScrollY + 1 >= initialState.scrollY) {
        window.scrollTo({ top: initialState.scrollY, left: 0, behavior: "auto" });
      }
      scrollRestoredRef.current = true;
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [initialState.scrollY, orders.length, query.isFetching, query.isSuccess]);
  const returnStatisticsByOrderId = useMemo(
    () =>
      new Map(
        (returnStatisticsQuery.data ?? []).map((statistic) => [statistic.orderId, statistic]),
      ),
    [returnStatisticsQuery.data],
  );
  const deleteOrder = useMutation({
    mutationFn: (orderId: string) =>
      api<void>(`/api/admin/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      appToast.success("Заказ удалён из рабочих списков");
    },
    onError: (exception) =>
      appToast.error(exception instanceof Error ? exception.message : "Не удалось удалить заказ"),
  });
  const updateOrderStatus = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: Order["status"] }) =>
      api<Order>(`/api/admin/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      appToast.success("Статус заказа обновлён");
    },
    onError: (exception) =>
      appToast.error(exception instanceof Error ? exception.message : "Не удалось изменить статус"),
  });

  function orderStatusActions(order: Order): AppContextMenuAction[] {
    if (!canUpdateOrders || order.status === "CANCELLED") return [];

    return (Object.entries(orderStatusLabel) as Array<[Order["status"], string]>)
      .filter(([status]) => status !== order.status && status !== "PRICE_REVIEW")
      .map(([status, label], index) => ({
        label: `Установить статус: ${label}`,
        icon: ORDER_STATUS_ACTION_ICONS[status],
        destructive: status === "CANCELLED",
        disabled:
          updateOrderStatus.isPending ||
          (order.status === "PRICE_REVIEW" && status !== "CANCELLED") ||
          (status === "READY_FOR_PICKUP" && order.checkedItems !== order.items.length),
        separatorBefore: index === 0,
        onSelect: () => {
          if (status === "COMPLETED") {
            setOrderCompletionTarget(order);
            return;
          }
          updateOrderStatus.mutate({ orderId: order.id, status });
        },
      }));
  }

  function orderActions(order: Order): AppContextMenuAction[] {
    return [
      {
        label: "Открыть",
        icon: <Eye size={17} />,
        onSelect: () => openOrder(order.id),
      },
      ...orderStatusActions(order),
      ...(canManageWarehouse && order.status === "COMPLETED"
        ? [
            {
              label: "Создать возврат",
              icon: <RotateCcw size={17} />,
              onSelect: () =>
                navigate("/admin/warehouse/returns/new", {
                  state: {
                    sourceOrderId: order.id,
                    returnTo: `${location.pathname}${location.search}${location.hash}`,
                    returnState: { ordersTableState: captureTableState() },
                  },
                }),
            },
          ]
        : []),
      ...(canDeleteOrders
        ? [
            {
              label: "Удалить",
              icon: <Trash2 size={17} />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setDeleteTarget(order),
            },
          ]
        : []),
    ];
  }

  function openOrderContextMenu(order: Order, event: MouseEvent<HTMLTableRowElement>) {
    event.preventDefault();
    setOrderContextMenu({ order, x: event.clientX, y: event.clientY });
  }
  const columns: AppDataTableColumn<Order>[] = [
    {
      id: "id",
      header: "Заказ",
      value: (order) => order.displayCode,
      sortable: true,
      width: 132,
      cell: (order) => (
        <a
          className="admin-orders-link"
          href={`/admin/orders/${order.id}`}
          onClick={(event) => handleOrderLinkClick(event, order.id)}
        >
          <code className="admin-order-code">№ {order.displayCode}</code>
        </a>
      ),
    },
    {
      id: "customer",
      header: "Клиент",
      value: (order) => `${order.customerName ?? ""} ${order.customerEmail ?? ""}`.trim(),
      searchable: true,
      sortable: true,
      cell: (order) => (
        <div className="admin-table-main">
          <strong>{order.customerName ?? "Без привязки к клиенту"}</strong>
          <span>{order.customerEmail ?? "Заказ создан администратором"}</span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Статус",
      accessor: "status",
      filterable: true,
      filterOptions: Object.entries(orderStatusLabel).map(([value, label]) => ({ value, label })),
      cell: (order) => {
        const reservationIsActive =
          order.reservationExpiresAt && new Date(order.reservationExpiresAt).getTime() > Date.now();

        return (
          <div className="admin-order-status">
            <AppBadge tone={orderStatusTone(order.status)}>
              {orderStatusLabel[order.status]}
            </AppBadge>
            {reservationIsActive && (
              <AppBadge tone="orange">
                Резерв до {formatDateTime(order.reservationExpiresAt)}
              </AppBadge>
            )}
          </div>
        );
      },
    },
    {
      id: "stockShortage",
      header: "Расхождение",
      value: (order) => (stockShortageQuantity(order) > 0 ? "Есть" : "Нет"),
      searchable: false,
      filterable: true,
      filterOptions: [
        { value: "Есть", label: "Есть расхождение" },
        { value: "Нет", label: "Без расхождения" },
      ],
      cell: (order) => {
        const quantity = stockShortageQuantity(order);
        return quantity > 0 ? (
          <AppBadge tone="red">Расхождение: {quantity}</AppBadge>
        ) : (
          <span className="admin-order-shortage--none">—</span>
        );
      },
    },
    {
      id: "priceTier",
      header: "Тип цены",
      value: (order) => PRICE_TIER_LABELS[order.priceTier ?? "RETAIL"],
      filterable: true,
      filterOptions: Object.entries(PRICE_TIER_LABELS).map(([value, label]) => ({ value, label })),
      cell: (order) => {
        const priceTier = order.priceTier ?? "RETAIL";
        return <AppBadge tone={priceTierTone(priceTier)}>{PRICE_TIER_LABELS[priceTier]}</AppBadge>;
      },
    },
    {
      id: "comment",
      header: "Комментарий",
      value: (order) => [order.comment, order.printComment].filter(Boolean).join(" "),
      searchable: true,
      width: 280,
      cell: (order) => {
        const comment = order.comment?.trim();
        if (!comment)
          return <span className="admin-order-comment admin-order-comment--empty">—</span>;

        return (
          <AppTooltip content={<span className="admin-order-comment-tooltip">{comment}</span>}>
            <span className="admin-order-comment" tabIndex={0}>
              {comment}
            </span>
          </AppTooltip>
        );
      },
    },
    {
      id: "fulfillment",
      header: "Сборка",
      value: (order) =>
        `${order.assembledItems}/${order.items.length} ${order.checkedItems}/${order.items.length}`,
      sortable: true,
      cell: (order) => {
        const statistic = returnStatisticsByOrderId.get(order.id);
        const orderedQuantity = order.items.reduce((total, item) => total + item.quantity, 0);
        const returnedQuantity = statistic?.returnedQuantity ?? 0;
        const remainingQuantity = Math.max(0, orderedQuantity - returnedQuantity);
        const remainingTotal = Math.max(0, order.total - (statistic?.returnedTotal ?? 0));

        return (
          <div className="admin-table-main">
            <strong>
              {order.assembledItems}/{order.items.length} собрано · {order.checkedItems}/
              {order.items.length} проверено
            </strong>
            <span>
              {order.assemblyAssigneeName ?? "Сборщик не назначен"} /{" "}
              {order.checkingAssigneeName ?? "Проверяющий не назначен"}
            </span>
            {statistic && returnedQuantity > 0 ? (
              <div className="admin-order-return-statistic">
                <AppBadge tone="orange">Возврат</AppBadge>
                <span>
                  Продано: {formatQuantity(remainingQuantity)} из {formatQuantity(orderedQuantity)}{" "}
                  · Сумма: {formatMoney(order.total)} → {formatMoney(remainingTotal)}
                </span>
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "total",
      header: "Сумма",
      accessor: "total",
      sortable: true,
      align: "right",
      cell: (order) => <code>{formatMoney(order.total)}</code>,
    },
    {
      id: "createdAt",
      header: "Создан",
      accessor: "createdAt",
      sortable: true,
      cell: (order) => formatDateTime(order.createdAt),
    },
    {
      id: "actions",
      header: "",
      hideable: false,
      width: 56,
      align: "right",
      cell: (order) => (
        <AppActionMenu
          label={`Действия: заказ № ${order.displayCode}`}
          actions={orderActions(order)}
        />
      ),
    },
  ];

  function renderMobileOrder(order: Order) {
    const statistic = returnStatisticsByOrderId.get(order.id);
    const shortage = stockShortageQuantity(order);
    const priceTier = order.priceTier ?? "RETAIL";
    return (
      <article className={`admin-orders-card${shortage > 0 ? " admin-orders-card--shortage" : ""}`}>
        <a
          className="admin-orders-card__main"
          href={`/admin/orders/${order.id}`}
          onClick={(event) => handleOrderLinkClick(event, order.id)}
          aria-label={`Открыть заказ № ${order.displayCode}`}
        >
          <div className="admin-orders-card__heading">
            <strong className="admin-order-code">№ {order.displayCode}</strong>
            <AppBadge tone={orderStatusTone(order.status)}>
              {orderStatusLabel[order.status]}
            </AppBadge>
          </div>
          <span className="admin-orders-card__customer">
            {order.customerName ?? "Без привязки к клиенту"}
          </span>
          <div className="admin-orders-card__summary">
            <strong>{formatMoney(order.total)}</strong>
            <time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time>
          </div>
        </a>
        <div className="admin-orders-card__footer">
          <details
            className="admin-orders-card__details"
            open={expandedOrderIds.includes(order.id)}
            onClick={(event) => event.stopPropagation()}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setExpandedOrderIds((current) => {
                if (current.includes(order.id) === open) return current;
                return open ? [...current, order.id] : current.filter((id) => id !== order.id);
              });
            }}
          >
            <summary>Подробности</summary>
            <dl>
              {order.comment?.trim() && (
                <div>
                  <dt>Комментарий</dt>
                  <dd>{order.comment}</dd>
                </div>
              )}
              {order.customerEmail && (
                <div>
                  <dt>Контакт</dt>
                  <dd>{order.customerEmail}</dd>
                </div>
              )}
              <div>
                <dt>Тип цены</dt>
                <dd>{PRICE_TIER_LABELS[priceTier]}</dd>
              </div>
              <div>
                <dt>Сборка</dt>
                <dd>
                  {order.assembledItems}/{order.items.length} собрано · {order.checkedItems}/
                  {order.items.length} проверено
                </dd>
              </div>
              {order.assemblyAssigneeName && (
                <div>
                  <dt>Сборщик</dt>
                  <dd>{order.assemblyAssigneeName}</dd>
                </div>
              )}
              {order.checkingAssigneeName && (
                <div>
                  <dt>Проверяющий</dt>
                  <dd>{order.checkingAssigneeName}</dd>
                </div>
              )}
              {order.reservationExpiresAt &&
                new Date(order.reservationExpiresAt).getTime() > Date.now() && (
                  <div>
                    <dt>Резерв до</dt>
                    <dd>{formatDateTime(order.reservationExpiresAt)}</dd>
                  </div>
                )}
              {shortage > 0 && (
                <div>
                  <dt>Расхождение</dt>
                  <dd>{formatQuantity(shortage)}</dd>
                </div>
              )}
              {statistic && statistic.returnedQuantity > 0 && (
                <div>
                  <dt>Возвращено</dt>
                  <dd>
                    {formatQuantity(statistic.returnedQuantity)} ·{" "}
                    {formatMoney(statistic.returnedTotal)}
                  </dd>
                </div>
              )}
            </dl>
          </details>
          <div className="admin-orders-card__actions">
            <AppActionMenu
              label={`Действия: заказ № ${order.displayCode}`}
              actions={orderActions(order)}
            />
          </div>
        </div>
      </article>
    );
  }

  return (
    <AdminPage
      className="admin-orders-page"
      title="Заказы"
      eyebrow="Продажи"
      actions={
        canCreateOrder ? (
          <>
            <AppButton type="button" variant="secondary" onClick={() => setAssistantOpen(true)}>
              <Sparkles size={18} /> Помощник
            </AppButton>
            <AppButton
              type="button"
              className="admin-orders-create-desktop"
              onClick={() => openCreateOrder("/admin/orders/new")}
            >
              <Plus size={18} />
              Создать заказ
            </AppButton>
            <AppButton
              type="button"
              className="admin-orders-create-mobile"
              onClick={() => openCreateOrder("/admin/orders/new")}
            >
              <Plus size={18} />
              Создать заказ
            </AppButton>
          </>
        ) : null
      }
    >
      <div className="metric-grid admin-orders-metrics">
        <MetricCard
          icon={<ReceiptText size={18} />}
          label="Всего"
          value={summaryQuery.data?.total ?? 0}
          size="compact"
        />
        <MetricCard
          icon={<ReceiptText size={18} />}
          label="Новые"
          value={summaryQuery.data?.newOrders ?? 0}
          accent
          size="compact"
        />
        <MetricCard
          icon={<ReceiptText size={18} />}
          label="В работе"
          value={summaryQuery.data?.processing ?? 0}
          size="compact"
        />
        <MetricCard
          icon={<ClipboardCheck size={18} />}
          label="Готовы к выдаче"
          value={summaryQuery.data?.ready ?? 0}
          size="compact"
        />
      </div>

      <div ref={tablePanelRef}>
        <DataPanel title="Все заказы" className="admin-orders-panel">
          <AppDataTable
            data={orders}
            mode="server"
            page={page}
            pageSize={pageSize}
            totalItems={query.data?.totalItems ?? 0}
            totalPages={query.data?.totalPages ?? 0}
            columns={columns}
            rowId={(order) => order.id}
            onRowContextMenu={openOrderContextMenu}
            renderMobileRow={renderMobileOrder}
            mobileFilterDialog
            mobileToolbarFilterTags={
              createdDateRange?.from ? (
                <button
                  type="button"
                  aria-label="Убрать фильтр периода"
                  onClick={() => setCreatedDateRange(undefined)}
                >
                  {createdDateRange.from.toLocaleDateString("ru-RU")}
                  {createdDateRange.to
                    ? ` — ${createdDateRange.to.toLocaleDateString("ru-RU")}`
                    : ""}
                  <X size={13} aria-hidden="true" />
                </button>
              ) : undefined
            }
            initialScrollPosition={initialState.tableScroll}
            onScrollPositionChange={(position) => {
              tableScrollRef.current = position;
            }}
            loading={query.isLoading}
            error={query.isError ? "Не удалось загрузить заказы" : undefined}
            selectable={false}
            searchPlaceholder="Поиск по номеру, клиенту или комментарию"
            toolbarFilters={
              <AppDateRangePicker value={createdDateRange} onValueChange={setCreatedDateRange} />
            }
            activeToolbarFilters={createdDateRange ? 1 : 0}
            onClearToolbarFilters={() => setCreatedDateRange(undefined)}
            defaultPageSize={initialState.pageSize}
            initialPage={1}
            searchValue={search}
            onSearchChange={setSearch}
            filterValues={filterValues}
            onFilterValuesChange={setFilterValues}
            sortingState={sorting}
            onSortingStateChange={(value) => {
              setSorting(value);
              setPage(1);
            }}
            initialDensity={density}
            onDensityChange={setDensity}
            initialColumnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            rowClassName={(order) =>
              stockShortageQuantity(order) > 0 ? "admin-orders-row--stock-shortage" : undefined
            }
            emptyTitle="Заказы не найдены"
            emptyDescription={
              createdDateRange
                ? "За выбранный период заказов не найдено."
                : "Когда клиенты оформят покупки, они появятся в этой таблице."
            }
          />
        </DataPanel>
      </div>
      <AppContextMenu
        open={Boolean(orderContextMenu)}
        x={orderContextMenu?.x ?? 0}
        y={orderContextMenu?.y ?? 0}
        label={
          orderContextMenu
            ? `Действия: заказ № ${orderContextMenu.order.displayCode}`
            : "Действия с заказом"
        }
        actions={orderContextMenu ? orderActions(orderContextMenu.order) : []}
        onOpenChange={(open) => {
          if (!open) setOrderContextMenu(null);
        }}
      />
      {canCreateOrder && (
        <OrderAssistantModal
          open={assistantOpen}
          onOpenChange={setAssistantOpen}
          context={{
            mode: "CREATE",
            priceTier: "RETAIL",
            orderDate: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 10),
          }}
          onApplied={() => {
            void queryClient.invalidateQueries({ queryKey: ["orders"] });
          }}
          onOpenOrder={(orderId) => {
            setAssistantOpen(false);
            openOrder(orderId);
          }}
          onReviewDraft={(sessionId) => {
            setAssistantOpen(false);
            openCreateOrder(`/admin/orders/new?assistantSession=${encodeURIComponent(sessionId)}`);
          }}
        />
      )}
      <OrderCompletionFlow
        order={orderCompletionTarget}
        canReleaseWithStockShortage={user?.permissions?.includes("warehouse.negative_stock")}
        open={orderCompletionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setOrderCompletionTarget(null);
        }}
        onCompleted={(completedOrder) => {
          setOrderCompletionTarget(completedOrder);
          queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
        }}
      />
      <AppModal
        title="Удалить заказ?"
        description={
          deleteTarget
            ? `Заказ № ${deleteTarget.displayCode} будет скрыт из рабочих списков. Данные заказа останутся в базе.`
            : undefined
        }
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <div className="admin-orders-delete-modal__actions">
          <AppButton
            type="button"
            variant="secondary"
            disabled={deleteOrder.isPending}
            onClick={() => setDeleteTarget(null)}
          >
            Отменить
          </AppButton>
          <AppButton
            type="button"
            variant="danger"
            loading={deleteOrder.isPending}
            loadingText="Удаляем..."
            onClick={() => {
              if (deleteTarget) deleteOrder.mutate(deleteTarget.id);
            }}
          >
            Удалить заказ
          </AppButton>
        </div>
      </AppModal>
    </AdminPage>
  );
}
