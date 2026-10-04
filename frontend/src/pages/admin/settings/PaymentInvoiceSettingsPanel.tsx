import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPaymentInvoiceSettings,
  updatePaymentInvoiceSettings,
  type PaymentInvoiceSettings,
} from "@/shared/api/settings";
import { AppButton } from "@/shared/ui/AppButton";
import { AppInput, AppTextarea } from "@/shared/ui/AppField";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import "./PaymentInvoiceSettingsPanel.css";

const queryKey = ["payment-invoice-settings"];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Повторите попытку позже.";
}

export function PaymentInvoiceSettingsPanel() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey, queryFn: fetchPaymentInvoiceSettings });
  const [draft, setDraft] = useState<PaymentInvoiceSettings | null>(null);
  const values = draft ?? settings.data;
  const save = useMutation({
    mutationFn: updatePaymentInvoiceSettings,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setDraft(null);
      appToast.success("Реквизиты для счёта на оплату сохранены");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });

  function change(field: keyof PaymentInvoiceSettings, value: string) {
    if (!values) return;
    setDraft({ ...values, [field]: value });
    save.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values || save.isPending) return;
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    ) as PaymentInvoiceSettings;
    save.mutate(payload);
  }

  return (
    <DataPanel title="Счёт на оплату" className="payment-invoice-settings">
      <div className="payment-invoice-settings__body">
        <p className="payment-invoice-settings__hint">
          Общие реквизиты поставщика для печати счетов. Номер и дата берутся из заказа, НДС — 0.
        </p>
        {settings.isPending && <AppSkeleton />}
        {settings.isError && (
          <AppAlert
            title="Не удалось загрузить реквизиты"
            tone="danger"
            onRetry={() => settings.refetch()}
          >
            {errorMessage(settings.error)}
          </AppAlert>
        )}
        {values && (
          <form className="payment-invoice-settings__form" onSubmit={submit}>
            <div className="payment-invoice-settings__fields">
              <AppInput
                label="Поставщик"
                required
                maxLength={240}
                value={values.supplierName}
                disabled={save.isPending}
                onChange={(event) => change("supplierName", event.target.value)}
              />
              <AppInput
                label="БИН / ИИН поставщика"
                required
                inputMode="numeric"
                pattern="[0-9]{12}"
                title="Укажите 12 цифр"
                maxLength={12}
                value={values.supplierTaxId}
                disabled={save.isPending}
                onChange={(event) => change("supplierTaxId", event.target.value)}
              />
              <AppInput
                label="Банк получателя"
                required
                maxLength={240}
                value={values.bankName}
                disabled={save.isPending}
                onChange={(event) => change("bankName", event.target.value)}
              />
              <AppInput
                label="ИИК / IBAN"
                required
                pattern="KZ[A-Z0-9]{18}"
                title="KZ и 18 латинских букв или цифр"
                value={values.iban}
                disabled={save.isPending}
                onChange={(event) =>
                  change("iban", event.target.value.toUpperCase().replace(/\s/g, ""))
                }
              />
              <AppInput
                label="БИК"
                required
                pattern="[A-Z0-9]{8}([A-Z0-9]{3})?"
                title="8 или 11 латинских букв или цифр"
                value={values.bic}
                disabled={save.isPending}
                onChange={(event) =>
                  change("bic", event.target.value.toUpperCase().replace(/\s/g, ""))
                }
              />
              <AppInput
                label="КБе"
                required
                inputMode="numeric"
                pattern="[0-9]{2}"
                title="Укажите 2 цифры"
                maxLength={2}
                value={values.beneficiaryCode}
                disabled={save.isPending}
                onChange={(event) => change("beneficiaryCode", event.target.value)}
              />
              <AppInput
                label="Код назначения платежа"
                required
                inputMode="numeric"
                pattern="[0-9]{3}"
                title="Укажите 3 цифры"
                maxLength={3}
                value={values.paymentPurposeCode}
                disabled={save.isPending}
                onChange={(event) => change("paymentPurposeCode", event.target.value)}
              />
              <AppInput
                label="Исполнитель"
                maxLength={240}
                value={values.executor}
                disabled={save.isPending}
                onChange={(event) => change("executor", event.target.value)}
              />
            </div>
            <AppInput
              label="Договор"
              maxLength={500}
              value={values.contract}
              disabled={save.isPending}
              onChange={(event) => change("contract", event.target.value)}
            />
            <AppTextarea
              label="Условия оплаты"
              maxLength={2000}
              rows={4}
              value={values.paymentTerms}
              disabled={save.isPending}
              onChange={(event) => change("paymentTerms", event.target.value)}
            />
            {save.isError && (
              <AppAlert title="Не удалось сохранить реквизиты" tone="danger">
                {errorMessage(save.error)}
              </AppAlert>
            )}
            <div className="payment-invoice-settings__actions">
              <AppButton type="submit" loading={save.isPending} loadingText="Сохраняем…">
                Сохранить реквизиты
              </AppButton>
              {draft && <span>Есть несохранённые изменения</span>}
            </div>
          </form>
        )}
      </div>
    </DataPanel>
  );
}
