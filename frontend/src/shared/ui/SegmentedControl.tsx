import { useState } from "react";
import "./SegmentedControl.css";

export type SegmentedControlItem = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function SegmentedControl({
  items,
  value,
  defaultValue,
  onValueChange,
  className = "",
  ariaLabel = "Переключатель",
}: {
  items: string[] | SegmentedControlItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const normalizedItems = items.map((item) =>
    typeof item === "string" ? { value: item, label: item } : item,
  );
  const fallbackValue = defaultValue ?? normalizedItems[0]?.value ?? "";
  const [internalValue, setInternalValue] = useState(fallbackValue);
  const activeValue = value ?? internalValue;

  function selectValue(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }

  return (
    <div className={`segmented-control ${className}`} role="group" aria-label={ariaLabel}>
      {normalizedItems.map((item) => (
        <button
          type="button"
          className={item.value === activeValue ? "active" : ""}
          key={item.value}
          disabled={item.disabled}
          aria-pressed={item.value === activeValue}
          onClick={() => selectValue(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
