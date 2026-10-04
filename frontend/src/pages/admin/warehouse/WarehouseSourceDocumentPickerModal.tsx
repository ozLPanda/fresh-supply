import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCheckbox } from "@/shared/ui/AppControls";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppInput, AppSelect } from "@/shared/ui/AppField";
import { AppTable } from "@/shared/ui/AppTable";
import { AppContextMenu } from "@/shared/ui/AppContextMenu";
import {
  fetchWarehouseCounterparties,
  fetchWarehouseDocuments,
  type WarehouseDocumentSummary,
  type WarehouseDocumentType,
} from "@/shared/api/warehouse";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import { formatDateTime } from "@/shared/lib/dateTime";

const isInteractiveRowTarget = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("button, input, label, a, [role='button']"));

export const WAREHOUSE_SOURCE_DOCUMENT_TYPES: Array<{
  type: WarehouseDocumentType;
  actionLabel: string;
  pluralLabel: string;
  documentLabel: string;
}> = [
  { type: "RECEIPT", actionLabel: "Из приходов", pluralLabel: "приходов", documentLabel: "Приход" },
  {
    type: "PURCHASE_ORDER",
    actionLabel: "Из заказов поставщикам",
    pluralLabel: "заказов поставщикам",
    documentLabel: "Заказ поставщику",
  },
  {
    type: "INVENTORY",
    actionLabel: "Из инвентаризации",
    pluralLabel: "инвентаризаций",
    documentLabel: "Инвентаризация",
  },
  {
    type: "OPENING_BALANCE",
    actionLabel: "Из начальных остатков",
    pluralLabel: "начальных остатков",
    documentLabel: "Начальные остатки",
  },
  {
    type: "PRICE_SETTING",
    actionLabel: "Из установок цен",
    pluralLabel: "установок цен",
    documentLabel: "Установка цен",
  },
  {
    type: "CUSTOMER_RETURN",
    actionLabel: "Из возвратов",
    pluralLabel: "возвратов",
    documentLabel: "Возврат",
  },
  { type: "SALE", actionLabel: "Из продаж", pluralLabel: "продаж", documentLabel: "Продажа" },
];

export function WarehouseSourceDocumentPickerModal({
  open,
  onOpenChange,
  excludedDocumentIds,
  onAdd,
  documentType,
  afterImportHint = "После переноса проверьте количество и цену.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludedDocumentIds: ReadonlySet<string>;
  onAdd: (documents: WarehouseDocumentSummary[]) => void;
  documentType: WarehouseDocumentType;
  afterImportHint?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [counterpartyFilterId, setCounterpartyFilterId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    document: WarehouseDocumentSummary;
    x: number;
    y: number;
  } | null>(null);
  const documents = useQuery({
    queryKey: ["warehouse-documents"],
    queryFn: fetchWarehouseDocuments,
    enabled: open,
  });
  const counterparties = useQuery({
    queryKey: ["warehouse-counterparties"],
    queryFn: () => fetchWarehouseCounterparties(),
    enabled: open && documentType === "RECEIPT",
  });
  const sourceType = WAREHOUSE_SOURCE_DOCUMENT_TYPES.find((item) => item.type === documentType)!;
  const sourceLabel = sourceType.pluralLabel;
  const sourceDocumentLabel = sourceType.documentLabel;
  const sourceDocuments = useMemo(() => {
    return (documents.data ?? []).filter(
      (document) =>
        document.type === documentType &&
        document.status === "POSTED" &&
        !excludedDocumentIds.has(document.id) &&
        (documentType !== "RECEIPT" ||
          !counterpartyFilterId ||
          document.counterpartyId === counterpartyFilterId) &&
        (!search.trim() ||
          adminMatchesSearch(
            `${document.documentNumber ?? ""} ${document.reference ?? ""} ${document.counterpartyName ?? ""}`,
            search,
          )),
    );
  }, [counterpartyFilterId, documentType, documents.data, excludedDocumentIds, search]);

  function close(nextOpen: boolean) {
    if (!nextOpen) {
      setSearch("");
      setCounterpartyFilterId("");
      setSelectedIds(new Set());
      setContextMenu(null);
    }
    onOpenChange(nextOpen);
  }

  function toggleDocument(documentId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  }

  function openDocument(document: WarehouseDocumentSummary) {
    close(false);
    navigate(`/admin/warehouse/documents/${document.id}`, {
      state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
    });
  }

  return (
    <AppModal
      title={`Добавить из ${sourceLabel}`}
      description={`Выберите проведённые складские документы типа «${sourceDocumentLabel}». Повторяющиеся товары будут добавлены только один раз. ${afterImportHint}`}
      open={open}
      onOpenChange={close}
      onInteractOutside={(event) => {
        if (event.target instanceof Element && event.target.closest(".app-context-menu")) {
          event.preventDefault();
        }
      }}
      contentClassName="warehouse-purchase-progress-modal warehouse-receipt-picker-modal"
    >
      <div className="warehouse-receipt-picker__body">
        <div className="warehouse-receipt-picker__filters">
          <AppInput
            label={`Поиск ${sourceLabel}`}
            value={search}
            placeholder="Номер, основание или контрагент"
            onChange={(event) => setSearch(event.target.value)}
          />
          {documentType === "RECEIPT" && (
            <AppSelect
              label="Контрагент"
              searchable
              value={counterpartyFilterId}
              onValueChange={(value) => setCounterpartyFilterId(String(value))}
              options={[
                { value: "", label: "Все контрагенты" },
                ...(counterparties.data ?? []).map((counterparty) => ({
                  value: counterparty.id,
                  label: counterparty.name,
                })),
              ]}
            />
          )}
        </div>
        {documents.isError ? (
          <AppAlert
            tone="danger"
            title={`Не удалось загрузить документы ${sourceLabel}`}
            onRetry={() => documents.refetch()}
          />
        ) : documents.isLoading ? (
          <p className="warehouse-receipt-picker__state">Загружаем документы…</p>
        ) : sourceDocuments.length === 0 ? (
          <div className="warehouse-receipt-picker__empty-state">
            <strong>Нет подходящих проведённых документов</strong>
            <span>Измените поисковый запрос или сначала проведите документ.</span>
          </div>
        ) : (
          <div className="warehouse-receipt-picker__table-scroll">
            <AppTable
              className="warehouse-receipt-picker__table"
              headers={["Документ", "Контрагент", "Основание", "Проведён"]}
              body={sourceDocuments.map((document) => {
                const checked = selectedIds.has(document.id);
                return (
                  <tr
                    key={document.id}
                    className={checked ? "is-selected" : undefined}
                    onClick={(event) => {
                      if (!isInteractiveRowTarget(event.target))
                        toggleDocument(document.id, !checked);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ document, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <td>
                      <AppCheckbox
                        label={document.documentNumber ?? sourceDocumentLabel}
                        description={sourceDocumentLabel}
                        checked={checked}
                        onCheckedChange={(nextChecked) => toggleDocument(document.id, nextChecked)}
                      />
                    </td>
                    <td>{document.counterpartyName ?? "—"}</td>
                    <td>{document.reference ?? "Без основания"}</td>
                    <td>{formatDateTime(document.postedAt ?? document.createdAt)}</td>
                  </tr>
                );
              })}
            />
          </div>
        )}
      </div>
      <AppContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        label="Действия с документом"
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setContextMenu(null);
        }}
        actions={
          contextMenu
            ? [
                {
                  label: "Открыть документ",
                  icon: <Eye size={17} />,
                  onSelect: () => openDocument(contextMenu.document),
                },
              ]
            : []
        }
      />
      <div className="warehouse-receipt-picker__footer">
        <span className="warehouse-receipt-picker__selected-count">
          Выбрано документов: {selectedIds.size}
        </span>
        <div>
          <AppButton type="button" variant="ghost" onClick={() => close(false)}>
            Отмена
          </AppButton>
          <AppButton
            type="button"
            disabled={selectedIds.size === 0 || documents.isFetching || documents.isError}
            onClick={() => {
              onAdd(sourceDocuments.filter((document) => selectedIds.has(document.id)));
              close(false);
            }}
          >
            Добавить позиции{selectedIds.size ? `: ${selectedIds.size}` : ""}
          </AppButton>
        </div>
      </div>
    </AppModal>
  );
}
