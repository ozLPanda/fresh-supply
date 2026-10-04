import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { API_URL, api } from "@/shared/api/http";
import { PRICE_TIER_LABELS } from "@/features/orders/price-tier";
import { formatMoney } from "@/pages/public/store-utils";
import { PriceTier, TemporaryInvoicePreview } from "@/shared/types/models";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppSelect } from "@/shared/ui/AppField";
import { appToast } from "@/shared/ui/AppToast";
import "./TemporaryInvoicePanel.css";

async function openTemporaryInvoice(cartItemIds: number[], priceTier: PriceTier) {
  const previewWindow = window.open("about:blank", "_blank");
  if (!previewWindow) {
    appToast.error("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
    return;
  }

  previewWindow.document.title = "Загрузка накладной…";
  previewWindow.document.body.textContent = "Формируем накладную…";

  try {
    const response = await fetch(`${API_URL}/api/cart/temporary-invoice.pdf`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceTier, selection: { cartItemIds } }),
    });
    if (!response.ok) {
      let message = "Не удалось сформировать накладную";
      try {
        const error = (await response.json()) as { message?: string };
        if (error.message) message = error.message;
      } catch {
        // A proxy can return an HTML error page instead of an API response.
      }
      throw new Error(message);
    }
    const pdfUrl = URL.createObjectURL(await response.blob());
    previewWindow.location.replace(pdfUrl);
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 30 * 60 * 1_000);
  } catch (error) {
    previewWindow.close();
    appToast.error(error instanceof Error ? error.message : "Не удалось сформировать накладную");
  }
}

export function TemporaryInvoicePanel({
  cartItemIds,
  cartVersion,
}: {
  cartItemIds: number[];
  cartVersion: string;
}) {
  const [priceTier, setPriceTier] = useState<PriceTier | null>(null);
  const [creating, setCreating] = useState(false);
  const preview = useQuery({
    queryKey: ["temporary-invoice-preview", cartVersion],
    queryFn: () =>
      api<TemporaryInvoicePreview>("/api/cart/temporary-invoice/preview", {
        method: "POST",
        body: JSON.stringify({ cartItemIds }),
      }),
    enabled: cartItemIds.length > 0,
    placeholderData: keepPreviousData,
  });
  const selectedOption = useMemo(
    () => preview.data?.priceOptions.find((option) => option.priceTier === priceTier) ?? null,
    [preview.data, priceTier],
  );
  const previewData = preview.data;

  useEffect(() => {
    if (!preview.data) return;
    if (!preview.data.priceOptions.some((option) => option.priceTier === priceTier)) {
      setPriceTier(preview.data.mostFavorablePriceTier);
    }
  }, [preview.data, priceTier]);

  return (
    <AppCard
      title="Временная накладная"
      description="Сформируйте накладную по отмеченным товарам."
      className="temporary-invoice"
      actions={<AppBadge tone="blue">По разрешению</AppBadge>}
    >
      {preview.isLoading ? (
        <AppSkeleton />
      ) : preview.isError ? (
        <AppAlert
          title="Не удалось рассчитать накладную"
          tone="danger"
          onRetry={() => preview.refetch()}
        >
          Проверьте выбранные товары и повторите попытку.
        </AppAlert>
      ) : previewData && selectedOption && priceTier ? (
        <div className="temporary-invoice__content">
          <AppSelect
            label="Тип цены в накладной"
            value={priceTier}
            clearable={false}
            options={previewData.priceOptions.map((option) => ({
              value: option.priceTier,
              label: PRICE_TIER_LABELS[option.priceTier],
            }))}
            onValueChange={(value) => setPriceTier(value as PriceTier)}
          />
          <div className="temporary-invoice__metrics">
            <div>
              <span>Сумма накладной</span>
              <strong>{formatMoney(selectedOption.total)}</strong>
            </div>
            <div>
              <span>Прибыль</span>
              <strong className={selectedOption.profit > 0 ? "is-profit" : ""}>
                {selectedOption.profit > 0 ? `+${formatMoney(selectedOption.profit)}` : "0 ₸"}
              </strong>
              <small>
                Разница с наиболее выгодной ценой:{" "}
                {PRICE_TIER_LABELS[previewData.mostFavorablePriceTier]}
              </small>
            </div>
          </div>
          <div className="temporary-invoice__footer">
            <AppButton
              type="button"
              loading={creating}
              loadingText="Формируем..."
              onClick={() => {
                setCreating(true);
                void openTemporaryInvoice(cartItemIds, priceTier).finally(() => setCreating(false));
              }}
            >
              <Printer size={17} />
              Сформировать накладную
            </AppButton>
          </div>
        </div>
      ) : (
        <AppAlert title="Нет доступной цены" tone="warning">
          Выберите хотя бы один доступный товар с указанной ценой.
        </AppAlert>
      )}
    </AppCard>
  );
}
