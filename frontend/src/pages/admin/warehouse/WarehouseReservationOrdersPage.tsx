import { useMemo } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import {
  fetchWarehouseProductReservations,
  type WarehouseReservationOrder,
} from "@/shared/api/warehouse";
import { Order } from "@/shared/types/models";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import { formatDateTime } from "@/shared/lib/dateTime";
import { orderStatusLabel, orderStatusTone } from "@/pages/customer/OrdersPage";
import type { WarehouseBalancesReturnState } from "./WarehouseBalancesPage";
import "./WarehousePages.css";

const numberFormatter = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 3 });

type WarehouseDetailLocationState = {
  returnTo?: string;
  returnState?: WarehouseBalancesReturnState;
};

function balancesReturnContext(state: unknown) {
  const context = state as WarehouseDetailLocationState | null;
  if (context?.returnTo !== "/admin/warehouse") {
    return { returnPath: "/admin/warehouse", returnState: undefined };
  }
  const search = context.returnState?.search;
  const stockFilter = context.returnState?.stockFilter;
  return {
    returnPath: context.returnTo,
    returnState:
      typeof search === "string" || typeof stockFilter === "string"
        ? { search, stockFilter }
        : undefined,
  };
}

export function WarehouseReservationOrdersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { productId: rawProductId } = useParams();
  const productId = Number(rawProductId);
  const validProductId = Number.isSafeInteger(productId) && productId > 0;
  const { returnPath, returnState } = balancesReturnContext(location.state);
  const reservations = useQuery({
    queryKey: ["warehouse-product-reservations", productId],
    queryFn: () => fetchWarehouseProductReservations(productId),
    enabled: validProductId,
  });
  const openOrder = (order: WarehouseReservationOrder) =>
    navigate(`/admin/orders/${order.orderId}`, {
      state: { returnTo: `${location.pathname}${location.search}` },
    });
  const columns = useMemo<AppDataTableColumn<WarehouseReservationOrder>[]>(
    () => [
      {
        id: "order",
        header: "Заказ",
        value: (order) => order.orderCode,
        cell: (order) => <b>№ {order.orderCode}</b>,
      },
      {
        id: "status",
        header: "Статус",
        value: (order) => order.orderStatus,
        cell: (order) => {
          const status = order.orderStatus as Order["status"];
          return <AppBadge tone={orderStatusTone(status)}>{orderStatusLabel[status]}</AppBadge>;
        },
      },
      {
        id: "quantity",
        header: "В резерве",
        value: (order) => order.quantity,
        align: "right",
        cell: (order) => `${numberFormatter.format(order.quantity)} ед.`,
      },
      {
        id: "reservedAt",
        header: "Зарезервирован",
        value: (order) => order.reservedAt,
        cell: (order) => formatDateTime(order.reservedAt, { dateStyle: "medium" }),
      },
      {
        id: "actions",
        header: "",
        hideable: false,
        searchable: false,
        align: "right",
        width: 56,
        cell: (order) => (
          <AppActionMenu
            label={`Действия: заказ № ${order.orderCode}`}
            actions={[
              {
                label: "Открыть заказ",
                icon: <ExternalLink size={17} />,
                onSelect: () => openOrder(order),
              },
            ]}
          />
        ),
      },
    ],
    [openOrder],
  );
  const backAction = (
    <AppButton
      type="button"
      variant="ghost"
      aria-label="К остаткам"
      title="К остаткам"
      onClick={() => navigate(returnPath, { state: returnState })}
    >
      <ArrowLeft size={18} aria-hidden="true" />
    </AppButton>
  );

  if (!validProductId) {
    return (
      <AdminPage eyebrow="Внутренний учёт" title="Резерв товара" backAction={backAction}>
        <AppAlert title="Товар не найден" tone="danger">
          Проверьте ссылку и попробуйте открыть резерв ещё раз.
        </AppAlert>
      </AdminPage>
    );
  }

  const product = reservations.data;
  return (
    <AdminPage
      eyebrow="Внутренний учёт"
      title={product ? `Резерв: ${product.productName}` : "Резерв товара"}
      backAction={backAction}
    >
      <div className="warehouse-page">
        <DataPanel
          title="Заказы, удерживающие товар"
          className="warehouse-table-panel"
          actions={
            product ? (
              <span className="warehouse-reservations-product">
                Артикул: <b>{product.sku}</b>
              </span>
            ) : undefined
          }
        >
          {reservations.isError ? (
            <div className="warehouse-panel-state">
              <AppAlert
                title="Не удалось загрузить резерв"
                tone="danger"
                onRetry={reservations.refetch}
              >
                Проверьте соединение с сервером и повторите попытку.
              </AppAlert>
            </div>
          ) : (
            <AppDataTable
              data={product?.orders ?? []}
              columns={columns}
              rowId={(order) => order.reservationId}
              loading={reservations.isLoading}
              searchable={false}
              selectable={false}
              pagination={false}
              contextMenuActions={(order) => [
                {
                  label: "Открыть заказ",
                  icon: <ExternalLink size={17} />,
                  onSelect: () => openOrder(order),
                },
              ]}
              contextMenuLabel={(order) => `Действия: заказ № ${order.orderCode}`}
              emptyTitle="Резерва нет"
              emptyDescription="Сейчас ни один заказ не удерживает этот товар."
            />
          )}
        </DataPanel>
      </div>
    </AdminPage>
  );
}
