import { WarehouseBalance } from "@/shared/api/warehouse";
import { AppBadge } from "@/shared/ui/AppBadge";
import "./OrderProductAvailability.css";

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 3 }).format(value);
}

export function OrderProductAvailability({
  madeToOrder,
  balance,
  showStock,
  stockLoading = false,
}: {
  madeToOrder?: boolean;
  balance?: WarehouseBalance;
  showStock: boolean;
  stockLoading?: boolean;
}) {
  if (!madeToOrder && !showStock) return null;

  return (
    <div className="order-product-availability" aria-label="Доступность товара">
      {madeToOrder && <AppBadge tone="orange">Под заказ</AppBadge>}
      {showStock &&
        (stockLoading ? (
          <AppBadge tone="slate">Остаток: загружаем</AppBadge>
        ) : balance ? (
          <>
            <AppBadge
              className="order-product-availability__desktop"
              tone={balance.available > 0 ? "green" : "red"}
              title={`На складе: ${formatQuantity(balance.onHand)}; в резерве: ${formatQuantity(balance.reserved)}`}
            >
              Остаток: {formatQuantity(balance.onHand)} · свободно:{" "}
              {formatQuantity(balance.available)}
            </AppBadge>
            <details className="order-product-availability__details">
              <summary>
                <AppBadge tone={balance.available > 0 ? "green" : "red"}>
                  Остаток: {formatQuantity(balance.onHand)} · свободно:{" "}
                  {formatQuantity(balance.available)}
                </AppBadge>
                <span className="order-product-availability__details-label">Подробнее</span>
              </summary>
              <dl>
                <div>
                  <dt>На складе</dt>
                  <dd>{formatQuantity(balance.onHand)}</dd>
                </div>
                <div>
                  <dt>В резерве</dt>
                  <dd>{formatQuantity(balance.reserved)}</dd>
                </div>
                <div>
                  <dt>Свободно</dt>
                  <dd>{formatQuantity(balance.available)}</dd>
                </div>
              </dl>
            </details>
          </>
        ) : (
          <AppBadge tone="slate">Нет данных по остатку</AppBadge>
        ))}
    </div>
  );
}
