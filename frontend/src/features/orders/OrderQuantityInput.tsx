import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { AppInput, type AppInputProps } from "@/shared/ui/AppField";

export const MIN_ORDER_QUANTITY = 0.001;
export const MAX_ORDER_QUANTITY = 999;

export function normalizeOrderQuantity(
  value: number,
  fallback = MIN_ORDER_QUANTITY,
  maxQuantity = MAX_ORDER_QUANTITY,
  minQuantity = MIN_ORDER_QUANTITY,
) {
  if (!Number.isFinite(value)) return fallback;
  return Number(Math.min(maxQuantity, Math.max(minQuantity, value)).toFixed(3));
}

function normalizeInputValue(value: string) {
  const decimalValue = value.replace(",", ".").replace(/[^0-9.]/g, "");
  const separatorIndex = decimalValue.indexOf(".");
  if (separatorIndex === -1) return decimalValue;
  return `${decimalValue.slice(0, separatorIndex + 1)}${decimalValue
    .slice(separatorIndex + 1)
    .replace(/\./g, "")}`;
}

export function OrderQuantityInput({
  value,
  onValueChange,
  onBlur,
  onFocus,
  onKeyDown,
  selectOnFocus = false,
  minQuantity = MIN_ORDER_QUANTITY,
  maxQuantity = MAX_ORDER_QUANTITY,
  ...props
}: Omit<AppInputProps, "type" | "value" | "onChange" | "min" | "max" | "step"> & {
  value: number;
  onValueChange: (value: number) => void;
  /** Selects the complete current value when the field receives focus. */
  selectOnFocus?: boolean;
  minQuantity?: number;
  maxQuantity?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(String(value));

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setInputValue(String(value));
  }, [value]);

  const commitValue = () => {
    const nextValue = normalizeOrderQuantity(Number(inputValue), value, maxQuantity, minQuantity);
    setInputValue(String(nextValue));
    if (nextValue !== value) onValueChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (!event.defaultPrevented && event.key === "Enter") event.currentTarget.blur();
  };

  return (
    <AppInput
      {...props}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={inputValue}
      onChange={(event) => {
        const nextInputValue = normalizeInputValue(event.target.value);
        setInputValue(nextInputValue);
        if (!nextInputValue || nextInputValue.endsWith(".")) return;
        const nextValue = Number(nextInputValue);
        if (!Number.isFinite(nextValue) || nextValue < minQuantity) return;
        onValueChange(normalizeOrderQuantity(nextValue, value, maxQuantity, minQuantity));
      }}
      onBlur={(event) => {
        commitValue();
        onBlur?.(event);
      }}
      onFocus={(event) => {
        if (selectOnFocus) event.currentTarget.select();
        onFocus?.(event);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
