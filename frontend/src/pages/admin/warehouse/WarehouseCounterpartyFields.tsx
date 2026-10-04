import { AppInput, AppTextarea } from "@/shared/ui/AppField";
import type { WarehouseCounterpartyInput } from "@/shared/api/warehouse";

export function emptyWarehouseCounterpartyInput(): WarehouseCounterpartyInput {
  return {
    name: "",
    contactName: "",
    phone: "",
    email: "",
    comment: "",
    archived: false,
  };
}

export function WarehouseCounterpartyFields({
  value,
  onChange,
}: {
  value: WarehouseCounterpartyInput;
  onChange: (value: WarehouseCounterpartyInput) => void;
}) {
  return (
    <>
      <AppInput
        label="Название"
        required
        autoFocus
        value={value.name}
        placeholder="Например: ТОО «Поставщик»"
        onChange={(event) => onChange({ ...value, name: event.target.value })}
      />
      <AppInput
        label="Контактное лицо"
        value={value.contactName ?? ""}
        onChange={(event) => onChange({ ...value, contactName: event.target.value })}
      />
      <div className="warehouse-counterparty-modal__contacts">
        <AppInput
          label="Телефон"
          value={value.phone ?? ""}
          onChange={(event) => onChange({ ...value, phone: event.target.value })}
        />
        <AppInput
          label="E-mail"
          type="email"
          value={value.email ?? ""}
          onChange={(event) => onChange({ ...value, email: event.target.value })}
        />
      </div>
      <AppTextarea
        label="Комментарий"
        rows={3}
        value={value.comment ?? ""}
        onChange={(event) => onChange({ ...value, comment: event.target.value })}
      />
    </>
  );
}
