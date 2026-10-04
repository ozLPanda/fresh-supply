import type { MeasurementUnit, OrderItem } from "@/shared/types/models";
import { measurementUnitLabel, measurementUnitOptions } from "@/shared/lib/measurementUnit";
import { AppSelect } from "@/shared/ui/AppField";
import { formatMoney } from "@/pages/public/store-utils";
import "./OrderItemUnitFields.css";

export type OrderItemUnits = Record<number, MeasurementUnit>;

export function orderItemUnitsPayload(items: OrderItem[], units: OrderItemUnits) {
  return items.map((item) => ({
    orderItemId: item.id,
    measurementUnit: units[item.id] ?? item.measurementUnit ?? "PIECE",
  }));
}

export function OrderItemUnitFields({
  items,
  values,
  onChange,
  disabled = false,
}: {
  items: OrderItem[];
  values: OrderItemUnits;
  onChange: (values: OrderItemUnits) => void;
  disabled?: boolean;
}) {
  return (
    <section className="order-item-unit-fields" aria-label="Единицы измерения при отпуске">
      <div className="order-item-unit-fields__heading">
        <strong>Единицы измерения при отпуске</strong>
        <p>
          Проверьте единицу каждой позиции для накладной. Выбор действует только на этот заказ;
          количество и цена не пересчитываются.
        </p>
      </div>
      <div className="order-item-unit-fields__list">
        {items.map((item) => {
          const unit = values[item.id] ?? item.measurementUnit ?? "PIECE";
          return (
            <div className="order-item-unit-fields__row" key={item.id}>
              <div className="order-item-unit-fields__product">
                <strong>{item.nameRu}</strong>
                <small>Артикул: {item.sku || "—"}</small>
                <span>
                  {item.quantity.toLocaleString("ru-RU")} {measurementUnitLabel(unit)} ×{" "}
                  {formatMoney(item.unitPrice)}
                </span>
              </div>
              <AppSelect
                label="Единица"
                aria-label={`Единица измерения: ${item.nameRu}`}
                value={unit}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...values, [item.id]: event.target.value as MeasurementUnit })
                }
              >
                {measurementUnitOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </AppSelect>
            </div>
          );
        })}
      </div>
    </section>
  );
}
