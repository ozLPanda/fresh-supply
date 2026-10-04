import { useMemo, useState } from "react";
import {
  Boxes,
  ClipboardPenLine,
  FileDown,
  LockKeyhole,
  ListOrdered,
  PackageCheck,
  PackagePlus,
  Search,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import {
  downloadWarehouseBalancesPdf,
  fetchWarehouseBalances,
  type WarehouseBalance,
  type WarehouseBalancesPdfMode,
  type WarehouseBalancesStockFilter,
} from "@/shared/api/warehouse";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton, AppSplitButton } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { AppInput, AppSelect } from "@/shared/ui/AppField";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./WarehousePages.css";

const numberFormatter = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 3 });

export type WarehouseBalancesReturnState = {
  search?: string;
  stockFilter?: WarehouseBalancesStockFilter;
};

const STOCK_FILTER_OPTIONS: Array<{ value: WarehouseBalancesStockFilter; label: string }> = [
  { value: "ALL", label: "Все остатки" },
  { value: "ZERO", label: "Ровно 0" },
  { value: "BELOW_ZERO", label: "Меньше 0" },
  { value: "IN_STOCK", label: "Есть в наличии" },
  { value: "BELOW_10", label: "Меньше 10" },
  { value: "BELOW_100", label: "Меньше 100" },
];

function isStockFilter(value: unknown): value is WarehouseBalancesStockFilter {
  return STOCK_FILTER_OPTIONS.some((option) => option.value === value);
}

function matchesStockFilter(item: WarehouseBalance, filter: WarehouseBalancesStockFilter) {
  switch (filter) {
    case "ZERO":
      return item.onHand === 0;
    case "BELOW_ZERO":
      return item.onHand < 0;
    case "IN_STOCK":
      return item.onHand > 0;
    case "BELOW_10":
      return item.onHand < 10;
    case "BELOW_100":
      return item.onHand < 100;
    default:
      return true;
  }
}

function quantity(value: number) {
  return numberFormatter.format(value);
}

export function WarehouseBalancesPage({
  onCreateDocument,
}: {
  onCreateDocument?: (
    type: "OPENING_BALANCE" | "RECEIPT",
    returnState: WarehouseBalancesReturnState,
  ) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => {
    const state = location.state as WarehouseBalancesReturnState | null;
    return typeof state?.search === "string" ? state.search : "";
  });
  const [stockFilter, setStockFilter] = useState<WarehouseBalancesStockFilter>(() => {
    const state = location.state as WarehouseBalancesReturnState | null;
    return isStockFilter(state?.stockFilter) ? state.stockFilter : "ALL";
  });
  const [exportingPdfMode, setExportingPdfMode] = useState<WarehouseBalancesPdfMode | null>(null);
  const returnState = useMemo<WarehouseBalancesReturnState>(
    () => ({ search, stockFilter }),
    [search, stockFilter],
  );
  const balances = useQuery({
    queryKey: ["warehouse-balances"],
    queryFn: fetchWarehouseBalances,
  });
  const rows = useMemo(() => {
    return (balances.data ?? []).filter(
      (item) =>
        (!search.trim() || adminMatchesSearch(`${item.sku} ${item.productName}`, search)) &&
        matchesStockFilter(item, stockFilter),
    );
  }, [balances.data, search, stockFilter]);
  const summary = useMemo(
    () =>
      rows.reduce(
        (result, item) => ({
          onHand: result.onHand + item.onHand,
          reserved: result.reserved + item.reserved,
          available: result.available + item.available,
        }),
        { onHand: 0, reserved: 0, available: 0 },
      ),
    [rows],
  );
  const columns = useMemo<AppDataTableColumn<WarehouseBalance>[]>(
    () => [
      {
        id: "product",
        header: "Товар",
        value: (item) => `${item.sku} ${item.productName}`,
        cell: (item) => (
          <div className="warehouse-product-cell">
            <b>{item.productName}</b>
            <span>Артикул: {item.sku}</span>
          </div>
        ),
        width: 420,
      },
      {
        id: "onHand",
        header: "Фактически",
        value: (item) => item.onHand,
        align: "right",
        sortable: true,
        searchable: false,
        cell: (item) => (
          <div className="warehouse-quantity-cell">
            <b>{quantity(item.onHand)}</b>
            <span>ед.</span>
          </div>
        ),
      },
      {
        id: "reserved",
        header: "В резерве",
        value: (item) => item.reserved,
        align: "right",
        sortable: true,
        searchable: false,
        cell: (item) => <span>{quantity(item.reserved)}</span>,
      },
      {
        id: "available",
        header: "Свободно",
        value: (item) => item.available,
        align: "right",
        sortable: true,
        searchable: false,
        cell: (item) => (
          <AppBadge tone={item.available > 0 ? "green" : "slate"}>
            {quantity(item.available)} ед.
          </AppBadge>
        ),
      },
    ],
    [],
  );

  function openBalancesPdf(mode: WarehouseBalancesPdfMode) {
    if (exportingPdfMode) return;

    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      appToast.error("Разрешите открытие новых вкладок для просмотра PDF");
      return;
    }
    previewWindow.opener = null;
    previewWindow.document.title = "Формируем PDF…";
    previewWindow.document.body.textContent = "Формируем таблицу остатков…";
    setExportingPdfMode(mode);
    void downloadWarehouseBalancesPdf({ mode, search, stockFilter })
      .then((pdf) => {
        const pdfUrl = URL.createObjectURL(pdf);
        previewWindow.location.replace(pdfUrl);
        window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 30 * 60 * 1000);
      })
      .catch((error: unknown) => {
        previewWindow.close();
        appToast.error(
          error instanceof Error ? error.message : "Не удалось сформировать PDF-таблицу",
        );
      })
      .finally(() => setExportingPdfMode(null));
  }

  return (
    <AdminPage
      eyebrow="Внутренний учёт"
      title="Остатки на складе"
      actions={
        <>
          <div className="warehouse-balances-export">
            <AppSplitButton
              variant="secondary"
              onClick={() => openBalancesPdf("STANDARD")}
              actions={[
                {
                  label: "Остатки",
                  icon: <FileDown size={16} />,
                  onSelect: () => openBalancesPdf("STANDARD"),
                },
                {
                  label: "Для инвентаризации",
                  icon: <FileDown size={16} />,
                  onSelect: () => openBalancesPdf("INVENTORY"),
                },
              ]}
            >
              <FileDown size={17} />
              {exportingPdfMode ? "Формируем…" : "PDF-остатки"}
            </AppSplitButton>
          </div>
          <AppButton
            type="button"
            variant="secondary"
            onClick={() => onCreateDocument?.("OPENING_BALANCE", returnState)}
          >
            <ClipboardPenLine size={17} />
            Ввести начальные остатки
          </AppButton>
          <AppButton type="button" onClick={() => onCreateDocument?.("RECEIPT", returnState)}>
            <PackagePlus size={17} />
            Оформить приход
          </AppButton>
        </>
      }
    >
      <div className="warehouse-page">
        <div className="warehouse-metrics">
          <MetricCard
            icon={<Boxes size={20} />}
            label="Фактически"
            value={quantity(summary.onHand)}
            size="compact"
          />
          <MetricCard
            icon={<LockKeyhole size={20} />}
            label="В резерве"
            value={quantity(summary.reserved)}
            size="compact"
          />
          <MetricCard
            icon={<PackageCheck size={20} />}
            label="Свободно"
            value={quantity(summary.available)}
            size="compact"
            accent
          />
        </div>

        <DataPanel title="Остатки по номенклатуре" className="warehouse-table-panel">
          {balances.isError ? (
            <div className="warehouse-panel-state">
              <AppAlert
                title="Не удалось загрузить остатки"
                tone="danger"
                onRetry={balances.refetch}
              >
                Проверьте соединение с сервером и повторите попытку.
              </AppAlert>
            </div>
          ) : (
            <AppDataTable
              className="warehouse-balances-table"
              data={rows}
              columns={columns}
              rowId={(item) => String(item.productId)}
              loading={balances.isLoading}
              searchable={false}
              pagination={false}
              virtualized
              scrollHeight={560}
              rowHeight={56}
              overscan={8}
              contextMenuActions={(item) => [
                {
                  label: "Движение товара",
                  icon: <ListOrdered size={17} />,
                  onSelect: () =>
                    navigate(`/admin/warehouse/balances/${item.productId}/movements`, {
                      state: { returnTo: "/admin/warehouse", returnState },
                    }),
                },
                {
                  label: "Резерв",
                  icon: <LockKeyhole size={17} />,
                  disabled: item.reserved <= 0,
                  onSelect: () =>
                    navigate(`/admin/warehouse/balances/${item.productId}/reservations`, {
                      state: { returnTo: "/admin/warehouse", returnState },
                    }),
                },
              ]}
              contextMenuLabel={(item) => `Действия: ${item.productName}`}
              toolbarFilters={
                <>
                  <AppInput
                    fieldClassName="warehouse-balances-filter-search"
                    aria-label="Поиск по остаткам"
                    placeholder="Поиск по товару или артикулу"
                    prefix={<Search size={18} />}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <AppSelect
                    fieldClassName="warehouse-balances-filter-stock"
                    aria-label="Фильтр по фактическому остатку"
                    value={stockFilter}
                    onChange={(event) =>
                      setStockFilter(event.target.value as WarehouseBalancesStockFilter)
                    }
                  >
                    {STOCK_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </AppSelect>
                </>
              }
              emptyTitle="Остатков пока нет"
              emptyDescription="Оформите ввод начальных остатков или проведите приход товара."
            />
          )}
        </DataPanel>
      </div>
    </AdminPage>
  );
}
