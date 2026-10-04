import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { OrderAssistantItem, OrderAssistantSession } from "@/shared/api/orderAssistant";
import type { Product, MeasurementUnit } from "@/shared/types/models";
import { AppButton } from "@/shared/ui/AppButton";
import { AppInput, AppSelect } from "@/shared/ui/AppField";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { measurementUnitOptions } from "@/shared/lib/measurementUnit";
import { OrderProductPickerModal } from "./OrderProductPickerModal";
import "./OrderAssistantItemsEditor.css";

type EditItem = Omit<OrderAssistantItem, "quantity" | "unitPrice"> & {
  quantity: string;
  unitPrice: string;
};
const numeric = (value: string) => (value.trim() ? Number(value.replace(",", ".")) : null);
export function OrderAssistantItemsEditor({
  session,
  disabled,
  onSave,
  onEditingChange,
}: {
  session: OrderAssistantSession;
  disabled: boolean;
  onSave: (items: OrderAssistantItem[]) => Promise<boolean>;
  onEditingChange: (editing: boolean) => void;
}) {
  const [items, setItems] = useState<EditItem[] | null>(null);
  const [picker, setPicker] = useState<number | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);
  function patch(index: number, patch: Partial<EditItem>) {
    setItems(
      (current) => current?.map((item, i) => (i === index ? { ...item, ...patch } : item)) ?? null,
    );
  }
  function choose(product: Product) {
    if (product.id == null) return false;
    const price =
      session.priceTier === "WHOLESALE"
        ? product.wholesalePrice
        : session.priceTier === "BULK_WHOLESALE"
          ? product.bulkWholesalePrice
          : session.priceTier === "SKO"
            ? product.skoPrice
            : product.price;
    const values = {
      productId: product.id,
      name: product.nameRu,
      measurementUnit: product.measurementUnit ?? ("PIECE" as MeasurementUnit),
      unitPrice: price == null ? "" : String(price),
      product: null,
    };
    if (picker === "add")
      setItems((current) => [
        ...(current ?? []),
        { ...values, source: "Добавлено вручную", quantity: "1", issue: null },
      ]);
    else if (typeof picker === "number") patch(picker, values);
    setPicker(null);
  }
  async function save() {
    if (!items) return;
    const parsed = items.map((item) => ({
      ...item,
      quantity: numeric(item.quantity),
      unitPrice: numeric(item.unitPrice),
    }));
    if (
      parsed.some(
        (item) =>
          (item.quantity !== null &&
            (!Number.isFinite(item.quantity) ||
              item.quantity < 0.001 ||
              item.quantity > 999 ||
              Math.abs(item.quantity * 1000 - Math.round(item.quantity * 1000)) > 0.000001)) ||
          (item.unitPrice !== null &&
            (!Number.isFinite(item.unitPrice) ||
              item.unitPrice < 0 ||
              Math.abs(item.unitPrice * 100 - Math.round(item.unitPrice * 100)) > 0.000001)),
      )
    ) {
      setError(
        "Количество: от 0,001 до 999, до 3 знаков после запятой. Цена: неотрицательное число, до 2 знаков. Пустые значения останутся на уточнение.",
      );
      return;
    }
    setError(null);
    if (await onSave(parsed)) {
      setItems(null);
      onEditingChange(false);
    }
  }
  if (!items)
    return (
      <AppButton
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          setItems(
            session.proposal.items.map((item) => ({
              ...item,
              quantity: item.quantity == null ? "" : String(item.quantity),
              unitPrice: item.unitPrice == null ? "" : String(item.unitPrice),
            })),
          );
          onEditingChange(true);
        }}
      >
        <Pencil size={16} />
        Исправить состав вручную
      </AppButton>
    );
  return (
    <section className="order-assistant-editor" aria-label="Редактирование состава">
      <p>
        Сверьте строки с фотографией. Выберите товар, исправьте количество или удалите лишнее.
        Изменения сохранятся в диалоге после нажатия «Сохранить состав».
      </p>
      {items.map((item, index) => (
        <article key={index} className="order-assistant-editor__item">
          <div className="order-assistant-editor__heading">
            <strong>
              {index + 1}. {item.name || item.source || "Товар не выбран"}
            </strong>
            <AppButton
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={`Удалить строку ${index + 1}`}
              onClick={() => setItems((current) => current?.filter((_, i) => i !== index) ?? null)}
            >
              <Trash2 size={16} />
            </AppButton>
          </div>
          {item.source && <small>Из заявки: {item.source}</small>}
          <AppButton
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => setPicker(index)}
          >
            {item.productId ? "Заменить товар" : "Найти товар в каталоге"}
          </AppButton>
          <div className="order-assistant-editor__fields">
            <AppInput
              label="Количество"
              inputMode="decimal"
              value={item.quantity}
              disabled={disabled}
              onChange={(e) => patch(index, { quantity: e.target.value })}
            />
            <AppSelect
              label="Единица"
              value={item.measurementUnit ?? ""}
              options={[{ value: "", label: "Уточнить" }, ...measurementUnitOptions]}
              disabled={disabled}
              clearable={false}
              onValueChange={(value) =>
                patch(index, {
                  measurementUnit: value === "KG" || value === "PIECE" ? value : null,
                })
              }
            />
            <AppInput
              label="Цена, ₸ / ед."
              inputMode="decimal"
              value={item.unitPrice}
              disabled={disabled}
              onChange={(e) => patch(index, { unitPrice: e.target.value })}
            />
          </div>
          {item.issue && (
            <AppAlert tone="warning" title="Проверьте строку">
              {item.issue}
            </AppAlert>
          )}
          {item.issue && (
            <AppButton
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={() => patch(index, { issue: null })}
            >
              Проверено, снять вопрос
            </AppButton>
          )}
          <AppInput
            label="Что ещё нужно уточнить"
            value={item.issue ?? ""}
            disabled={disabled}
            placeholder="Оставьте пустым, если исправили строку"
            onChange={(e) => patch(index, { issue: e.target.value || null })}
          />
        </article>
      ))}
      {!items.length && (
        <p>Все строки удалены. Добавьте нужные товары или сохраните пустой черновик.</p>
      )}
      {error && (
        <AppAlert tone="danger" title="Проверьте значения">
          {error}
        </AppAlert>
      )}
      <div className="order-assistant-editor__actions">
        <AppButton
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => setPicker("add")}
        >
          <Plus size={16} />
          Добавить товар
        </AppButton>
        <AppButton type="button" disabled={disabled} onClick={() => void save()}>
          Сохранить состав
        </AppButton>
        <AppButton
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setItems(null);
            setError(null);
            onEditingChange(false);
          }}
        >
          Отмена
        </AppButton>
      </div>
      <OrderProductPickerModal
        open={picker !== null}
        onOpenChange={(value) => {
          if (!value) setPicker(null);
        }}
        priceTier={session.priceTier}
        onAdd={choose}
        allowMissingPrice
        destinationName="черновик помощника"
      />
    </section>
  );
}
