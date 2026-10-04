import { useQuery } from "@tanstack/react-query";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { fetchRegularBuyers } from "@/shared/api/regularBuyers";
import { AppSelect, type AppSelectOption } from "@/shared/ui/AppField";
import { AppAlert } from "@/shared/ui/AppFeedback";
import "./RegularBuyerSelect.css";

export function RegularBuyerSelect({
  value,
  onChange,
  disabled = false,
  currentName,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  currentName?: string | null;
}) {
  const { user } = useCommerce();
  const canRead = user?.permissions.some((permission) =>
    ["regular-buyers.read", "regular-buyers.manage", "orders.update"].includes(permission),
  );
  const buyers = useQuery({
    queryKey: ["regular-buyers", value ? "all" : "active"],
    queryFn: () => fetchRegularBuyers(Boolean(value)),
    enabled: Boolean(canRead),
  });
  const options: AppSelectOption[] = [
    { value: "", label: "Без постоянного покупателя" },
    ...(buyers.data ?? [])
      .filter((buyer) => !buyer.archived || buyer.id === value)
      .map((buyer) => ({
        value: buyer.id,
        label: `${buyer.name}${buyer.archived ? " (в архиве)" : ""}`,
      })),
  ];
  if (value && !options.some((option) => option.value === value)) {
    options.push({ value, label: currentName || "Текущий покупатель", disabled: true });
  }

  return (
    <div className="regular-buyer-select">
      <AppSelect
        label="Постоянный покупатель"
        options={options}
        value={value ?? ""}
        onValueChange={(selected) =>
          onChange(typeof selected === "string" && selected ? selected : null)
        }
        searchable
        disabled={disabled || !canRead || buyers.isPending || buyers.isError}
        hint={
          buyers.isPending && canRead
            ? "Загружаем покупателей…"
            : "Наименование попадёт в поле «Организация (индивидуальный предприниматель) — получатель» накладной. Без выбора поле останется пустым."
        }
      />
      {buyers.isError && (
        <AppAlert
          title="Не удалось загрузить покупателей"
          tone="danger"
          onRetry={() => buyers.refetch()}
        >
          Текущий выбор сохранён. Повторите загрузку, чтобы изменить покупателя.
        </AppAlert>
      )}
    </div>
  );
}
