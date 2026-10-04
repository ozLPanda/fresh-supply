import { useMemo } from "react";
import { AlertTriangle, ArrowLeft, ExternalLink, PackageX } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import {
  fetchWarehouseStockShortages,
  type WarehouseStockShortageRelease,
} from "@/shared/api/warehouse";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import { formatDateTime } from "@/shared/lib/dateTime";
import { Order } from "@/shared/types/models";
import { orderStatusLabel, orderStatusTone } from "@/pages/customer/OrdersPage";
import "./WarehousePages.css";

const numberFormatter = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 3 });

function quantity(value: number) {
  return numberFormatter.format(value);
}

export function WarehouseStockShortagesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const shortages = useQuery({
    queryKey: ["warehouse-stock-shortages"],
    queryFn: fetchWarehouseStockShortages,
  });
  const rows = shortages.data ?? [];
  const affectedOrders = useMemo(() => new Set(rows.map((item) => item.orderId)).size, [rows]);
  const totalQuantity = useMemo(
    () => rows.reduce((total, item) => total + item.shortageQuantity, 0),
    [rows],
  );
  const openOrder = (item: WarehouseStockShortageRelease) =>
    navigate(`/admin/orders/${item.orderId}`, {
      state: { returnTo: `${location.pathname}${location.search}` },
    });
  const columns = useMemo<AppDataTableColumn<WarehouseStockShortageRelease>[]>(
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
        id: "shortageQuantity",
        header: "Отпущено в минус",
        value: (item) => item.shortageQuantity,
        searchable: false,
        align: "right",
        cell: (item) => <AppBadge tone="red">−{quantity(item.shortageQuantity)} ед.</AppBadge>,
      },
      {
        id: "order",
        header: "Заказ",
        value: (item) => item.orderCode,
        cell: (item) => <b>№ {item.orderCode}</b>,
      },
      {
        id: "status",
        header: "Статус",
        value: (item) => item.orderStatus,
        filterable: true,
        filterOptions: Object.entries(orderStatusLabel).map(([value, label]) => ({ value, label })),
        cell: (item) => {
          const status = item.orderStatus as Order["status"];
          return <AppBadge tone={orderStatusTone(status)}>{orderStatusLabel[status]}</AppBadge>;
        },
      },
      {
        id: "releasedBy",
        header: "Отпустил",
        value: (item) => item.releasedByUserName ?? "—",
        filterable: true,
        cell: (item) => item.releasedByUserName ?? "—",
      },
      {
        id: "releasedAt",
        header: "Дата отпуска",
        value: (item) => item.releasedAt ?? "",
        cell: (item) =>
          item.releasedAt ? formatDateTime(item.releasedAt, { dateStyle: "medium" }) : "—",
      },
      {
        id: "comment",
        header: "Комментарий",
        value: (item) => item.comment ?? "",
        cell: (item) => <span className="warehouse-shortage-comment">{item.comment ?? "—"}</span>,
      },
      {
        id: "actions",
        header: "",
        width: 56,
        align: "right",
        hideable: false,
        searchable: false,
        cell: (item) => (
          <AppActionMenu
            label={`Действия: ${item.productName}`}
            actions={[
              {
                label: "Открыть заказ",
                icon: <ExternalLink size={17} />,
                onSelect: () => openOrder(item),
              },
            ]}
          />
        ),
      },
    ],
    [openOrder],
  );

  return (
    <AdminPage
      eyebrow="Внутренний учёт"
      title="Отпуски с расхождением"
      backAction={
        <AppButton
          type="button"
          variant="ghost"
          aria-label="К остаткам"
          title="К остаткам"
          onClick={() => navigate("/admin/warehouse")}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </AppButton>
      }
    >
      <div className="warehouse-page warehouse-shortages-page">
        <div className="warehouse-metrics">
          <MetricCard
            icon={<PackageX size={20} />}
            label="Проблемных позиций"
            value={rows.length}
            size="compact"
            accent
          />
          <MetricCard
            icon={<AlertTriangle size={20} />}
            label="Отпущено в минус"
            value={quantity(totalQuantity)}
            size="compact"
          />
          <MetricCard
            icon={<ExternalLink size={20} />}
            label="Затронуто заказов"
            value={affectedOrders}
            size="compact"
          />
        </div>

        <DataPanel title="Товары, отпущенные в минус" className="warehouse-table-panel">
          {shortages.isError ? (
            <div className="warehouse-panel-state">
              <AppAlert
                title="Не удалось загрузить отпуски с расхождением"
                tone="danger"
                onRetry={shortages.refetch}
              >
                Проверьте соединение с сервером и повторите попытку.
              </AppAlert>
            </div>
          ) : (
            <AppDataTable
              data={rows}
              columns={columns}
              rowId={(item) => String(item.orderItemId)}
              loading={shortages.isLoading}
              selectable={false}
              contextMenuActions={(item) => [
                {
                  label: "Открыть заказ",
                  icon: <ExternalLink size={17} />,
                  onSelect: () => openOrder(item),
                },
              ]}
              contextMenuLabel={(item) => `Действия: ${item.productName}`}
              rowClassName={() => "warehouse-shortage-row"}
              emptyTitle="Отпусков с расхождением нет"
              emptyDescription="Когда товар отпустят при подтверждённой нехватке, он появится в этом списке."
            />
          )}
        </DataPanel>
      </div>
    </AdminPage>
  );
}
