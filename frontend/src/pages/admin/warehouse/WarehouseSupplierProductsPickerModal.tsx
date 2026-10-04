import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchWarehouseCounterparties,
  fetchWarehouseDocuments,
  type WarehouseDocumentSummary,
} from "@/shared/api/warehouse";
import { AppButton } from "@/shared/ui/AppButton";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppSelect } from "@/shared/ui/AppField";
import "./WarehouseSupplierProductsPickerModal.css";

export function WarehouseSupplierProductsPickerModal({
  open,
  onOpenChange,
  initialCounterpartyId,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCounterpartyId?: string | null;
  onAdd: (documents: WarehouseDocumentSummary[]) => Promise<number | null>;
}) {
  const [counterpartyId, setCounterpartyId] = useState("");
  const [importing, setImporting] = useState(false);
  const counterparties = useQuery({
    queryKey: ["warehouse-counterparties", "all"],
    queryFn: () => fetchWarehouseCounterparties(true),
    enabled: open,
  });
  const documents = useQuery({
    queryKey: ["warehouse-documents"],
    queryFn: fetchWarehouseDocuments,
    enabled: open,
  });

  useEffect(() => {
    if (open) setCounterpartyId(initialCounterpartyId ?? "");
  }, [initialCounterpartyId, open]);

  const supplierOrders = useMemo(
    () =>
      (documents.data ?? []).filter(
        (document) =>
          document.type === "PURCHASE_ORDER" &&
          document.status === "POSTED" &&
          document.counterpartyId === counterpartyId,
      ),
    [counterpartyId, documents.data],
  );

  function close() {
    if (importing) return;
    setCounterpartyId("");
    onOpenChange(false);
  }

  async function addSupplierProducts() {
    if (!counterpartyId || supplierOrders.length === 0 || importing) return;
    setImporting(true);
    try {
      const addedCount = await onAdd(supplierOrders);
      if (addedCount !== null) {
        setCounterpartyId("");
        onOpenChange(false);
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppModal
      title="Импорт товаров от поставщика"
      description="Добавьте все уникальные товары из проведённых заказов выбранному поставщику. Товары, уже добавленные в документ, не дублируются."
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && close()}
      contentClassName="warehouse-supplier-products-modal"
    >
      <div className="warehouse-supplier-products-modal__content">
        {counterparties.isError || documents.isError ? (
          <AppAlert
            tone="danger"
            title="Не удалось загрузить поставщиков и заказы"
            onRetry={() => {
              if (counterparties.isError) void counterparties.refetch();
              if (documents.isError) void documents.refetch();
            }}
          />
        ) : (
          <>
            <AppSelect
              label="Поставщик"
              searchable
              clearable={false}
              options={[
                { value: "", label: "Выберите поставщика" },
                ...(counterparties.data ?? []).map((counterparty) => ({
                  value: counterparty.id,
                  label: counterparty.name,
                })),
              ]}
              value={counterpartyId}
              disabled={counterparties.isLoading || importing}
              onValueChange={(value) => setCounterpartyId(String(value))}
            />
            {counterpartyId && !documents.isLoading && (
              <p className="warehouse-supplier-products-modal__summary">
                {supplierOrders.length > 0
                  ? `Найдено проведённых заказов: ${supplierOrders.length}. Все их товары будут добавлены один раз.`
                  : "У этого поставщика пока нет проведённых заказов."}
              </p>
            )}
            <p className="warehouse-supplier-products-modal__hint">
              После импорта проверьте количество и цены перед сохранением документа.
            </p>
          </>
        )}
        <div className="warehouse-supplier-products-modal__actions">
          <AppButton type="button" variant="ghost" onClick={close} disabled={importing}>
            Отмена
          </AppButton>
          <AppButton
            type="button"
            loading={importing}
            loadingText="Добавляем товары"
            disabled={
              !counterpartyId ||
              supplierOrders.length === 0 ||
              documents.isFetching ||
              documents.isError ||
              counterparties.isError
            }
            onClick={() => void addSupplierProducts()}
          >
            Добавить все товары
          </AppButton>
        </div>
      </div>
    </AppModal>
  );
}
