import { useEffect, useRef, useState } from "react";
import { AppButton } from "@/shared/ui/AppButton";
import { AppMoneyInput } from "@/shared/ui/AppField";
import { AppModal } from "@/shared/ui/AppFeedback";
import {
  calculateProductPrices,
  isProductPriceInputValid,
  type ProductCalculatedPrices,
} from "./productPriceCalculator";
import "./ProductPriceCalculatorModal.css";

const money = new Intl.NumberFormat("ru-KZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ProductPriceCalculatorModal({
  open,
  onOpenChange,
  incomingPrice,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incomingPrice: number | null;
  onApply: (prices: ProductCalculatedPrices) => void;
}) {
  const [draft, setDraft] = useState(incomingPrice);
  const [invalidInput, setInvalidInput] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(incomingPrice);
      setInvalidInput(false);
    }
    wasOpen.current = open;
  }, [open, incomingPrice]);

  const calculation = calculateProductPrices(draft);
  const prices = invalidInput ? null : calculation.prices;
  const error = invalidInput
    ? "Введите сумму цифрами, используя запятую или точку для дробной части."
    : calculation.error;

  function apply() {
    if (!prices) return;
    onApply(prices);
    onOpenChange(false);
  }

  const preview = [
    { label: "Цена", markup: "+30%", value: prices?.price },
    { label: "Оптовая цена", markup: "+25%", value: prices?.wholesalePrice },
    { label: "Крупный опт", markup: "+20%", value: prices?.bulkWholesalePrice },
    { label: "Приходная цена", markup: "", value: prices?.incomingPrice },
  ];

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title="Калькулятор цен"
      description="Укажите приходную цену, чтобы рассчитать цены продажи."
      contentClassName="product-price-calculator"
    >
      <div
        className="product-price-calculator__body"
        onKeyDown={(event) => {
          // The product form may be outside this Radix portal. Never submit it.
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            event.stopPropagation();
            apply();
          }
        }}
      >
        <AppMoneyInput
          label="Приходная цена"
          value={draft}
          onValueChange={setDraft}
          onInputCapture={(event) =>
            setInvalidInput(!isProductPriceInputValid(event.currentTarget.value))
          }
          placeholder="Введите сумму"
          autoFocus
          error={error ?? undefined}
          hint="Суммы округляются до двух знаков после запятой."
        />
        <dl className="product-price-calculator__preview" aria-live="polite" aria-atomic="true">
          {preview.map(({ label, markup, value }) => (
            <div className="product-price-calculator__row" key={label}>
              <dt>
                <span>{label}</span>
                {markup && <small>{markup}</small>}
              </dt>
              <dd>{value === undefined ? "—" : `${money.format(value)} ₸`}</dd>
            </div>
          ))}
        </dl>
        <div className="product-price-calculator__actions">
          <AppButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </AppButton>
          <AppButton type="button" onClick={apply} disabled={!prices}>
            Применить
          </AppButton>
        </div>
      </div>
    </AppModal>
  );
}
