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
  hint,
  unresolved = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  currentName?: string | null;
  hint?: string;
  unresolved?: boolean;
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
  const visibleBuyers = (buyers.data ?? []).filter(
    (buyer) => !buyer.archived || buyer.id === value,
  );
  const nameKey = (name: string) =>
    name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru").replace(/ё/g, "е");
  const nameCounts = new Map<string, number>();
  visibleBuyers.forEach((buyer) =>
    nameCounts.set(nameKey(buyer.name), (nameCounts.get(nameKey(buyer.name)) ?? 0) + 1),
  );
  const options: AppSelectOption[] = [
    { value: "", label: "Без постоянного покупателя" },
    ...visibleBuyers.map((buyer) => {
      const duplicate = (nameCounts.get(nameKey(buyer.name)) ?? 0) > 1;
      const detail = buyer.taxId
        ? `ИИН/БИН ${buyer.taxId}`
        : buyer.phone || buyer.contactName || buyer.id.slice(0, 8);
      return {
        value: buyer.id,
        label: `${buyer.name}${duplicate ? ` · ${detail}` : ""}${buyer.archived ? " (в архиве)" : ""}`,
        keywords: [
          buyer.name,
          ...(buyer.aliases ?? []),
          buyer.taxId ?? "",
          buyer.phone ?? "",
          buyer.contactName ?? "",
        ].flatMap((name) => [name, name.replace(/ё/gi, "е")]),
      };
    }),
  ];
  if (value && !options.some((option) => option.value === value)) {
    options.push({ value, label: currentName || "Текущий покупатель", disabled: true });
  }

  return (
    <div className="regular-buyer-select">
      <AppSelect
        label="Постоянный покупатель"
        options={options}
        value={unresolved && !value ? "__unselected__" : (value ?? "")}
        placeholder="Выберите покупателя"
        onValueChange={(selected) =>
          onChange(typeof selected === "string" && selected ? selected : null)
        }
        searchable
        disabled={disabled || !canRead || buyers.isPending || buyers.isError}
        hint={
          buyers.isPending && canRead
            ? "Загружаем покупателей…"
            : (hint ??
              "Наименование попадёт в поле «Организация (индивидуальный предприниматель) — получатель» накладной. Без выбора поле останется пустым.")
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
