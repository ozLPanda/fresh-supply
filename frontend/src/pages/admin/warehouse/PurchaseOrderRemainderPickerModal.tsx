import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchPurchaseOrderRemainders,
  fetchWarehouseCounterparties,
  type PurchaseAllocation,
  type PurchaseOrderRemainder,
} from "@/shared/api/warehouse";
import { AppModal, AppAlert } from "@/shared/ui/AppFeedback";
import { AppButton } from "@/shared/ui/AppButton";
import { AppTable } from "@/shared/ui/AppTable";
import { AppCheckbox } from "@/shared/ui/AppControls";
import { AppInput, AppNumberInput, AppSelect } from "@/shared/ui/AppField";
import { AppContextMenu } from "@/shared/ui/AppContextMenu";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import { selectNumericInputOnFocus } from "./selectNumericInputOnFocus";

const lineKey = (orderId: string, productId: number) => `${orderId}:${productId}`;
const orderGroupSubtitle = (order: PurchaseOrderRemainder) =>
  order.document.counterpartyName ?? order.document.reference ?? "Без основания";
const isInteractiveRowTarget = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("button, input, label, a, [role='button']"));
const validQuantity = (value: number, maximum: number) =>
  Number.isFinite(value) &&
  value >= 0.001 &&
  value <= maximum &&
  Math.abs(value * 1000 - Math.round(value * 1000)) < 0.000001;

export function PurchaseOrderRemainderPickerModal({
  open,
  onOpenChange,
  documentId,
  initialCounterpartyId,
  allocations,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId?: string;
  /** Current supplier-order counterparty is preselected whenever the picker opens. */
  initialCounterpartyId?: string | null;
  allocations: PurchaseAllocation[];
  onAdd: (orders: PurchaseOrderRemainder[]) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [counterpartyFilterId, setCounterpartyFilterId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    document: PurchaseOrderRemainder["document"];
    x: number;
    y: number;
  } | null>(null);
  const query = useQuery({
    queryKey: ["warehouse-purchase-order-remainders", documentId],
    queryFn: () => fetchPurchaseOrderRemainders(documentId),
    enabled: open,
    staleTime: 0,
  });
  const counterparties = useQuery({
    queryKey: ["warehouse-counterparties"],
    queryFn: () => fetchWarehouseCounterparties(),
    enabled: open,
  });

  useEffect(() => {
    if (open) setCounterpartyFilterId(initialCounterpartyId ?? "");
  }, [initialCounterpartyId, open]);
  const availableOrders = useMemo(
    () =>
      (query.data ?? [])
        .map((order) => ({
          ...order,
          lines: order.lines
            .map((line) => ({
              ...line,
              quantity: Math.max(
                0,
                Math.round(
                  (line.quantity -
                    allocations
                      .filter(
                        (allocation) =>
                          allocation.sourceDocumentId === order.document.id &&
                          allocation.productId === line.productId,
                      )
                      .reduce((sum, allocation) => sum + allocation.quantity, 0)) *
                    1000,
                ) / 1000,
              ),
            }))
            .filter((line) => line.quantity > 0),
        }))
        .filter((order) => order.lines.length > 0),
    [query.data, allocations],
  );
  const visibleOrders = useMemo(
    () =>
      availableOrders
        .filter(
          (order) =>
            !counterpartyFilterId || order.document.counterpartyId === counterpartyFilterId,
        )
        .map((order) => {
          const documentMatches = adminMatchesSearch(
            `Заказ поставщику ${order.document.documentNumber ?? ""} ${orderGroupSubtitle(order)}`,
            search,
          );
          if (documentMatches) return order;

          const matchingLines = order.lines.filter((line) =>
            adminMatchesSearch(`${line.sku} ${line.productName}`, search),
          );
          return matchingLines.length ? { ...order, lines: matchingLines } : null;
        })
        .filter((order): order is PurchaseOrderRemainder => order !== null),
    [availableOrders, counterpartyFilterId, search],
  );
  const selected = availableOrders
    .map((order) => ({
      ...order,
      lines: order.lines
        .filter((line) => selectedIds.includes(lineKey(order.document.id, line.productId)))
        .map((line) => ({
          ...line,
          quantity: Number(quantities[lineKey(order.document.id, line.productId)] ?? line.quantity),
        })),
    }))
    .filter((order) => order.lines.length > 0);
  const selectedCount = selected.reduce((sum, order) => sum + order.lines.length, 0);
  const hasInvalidQuantity = availableOrders.some((order) =>
    order.lines.some((line) => {
      const key = lineKey(order.document.id, line.productId);
      return (
        selectedIds.includes(key) &&
        !validQuantity(Number(quantities[key] ?? line.quantity), line.quantity)
      );
    }),
  );
  function selectLines(keys: string[], checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, ...keys]))
        : current.filter((key) => !keys.includes(key)),
    );
  }
  function close(value: boolean) {
    if (!value) {
      setSearch("");
      setCounterpartyFilterId("");
      setSelectedIds([]);
      setQuantities({});
      setCollapsedIds([]);
      setContextMenu(null);
    }
    onOpenChange(value);
  }

  function openDocument(documentId: string) {
    close(false);
    navigate(`/admin/warehouse/documents/${documentId}`, {
      state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
    });
  }

  return (
    <AppModal
      open={open}
      onOpenChange={close}
      title="Из остатков заказов"
      onInteractOutside={(event) => {
        if (event.target instanceof Element && event.target.closest(".app-context-menu")) {
          event.preventDefault();
        }
      }}
      contentClassName="warehouse-purchase-progress-modal warehouse-remainder-picker-modal"
    >
      <div className="warehouse-remainder-picker__body">
        <p>
          Выберите отдельные позиции или весь заказ и укажите количество для переноса. Одинаковые
          товары объединяются, при разных ценах рассчитывается средневзвешенная цена. Остаток
          закрепляется после сохранения черновика.
        </p>
        <div className="warehouse-remainder-picker__filters">
          <AppInput
            label="Поиск по заказам и товарам"
            placeholder="Название или номер заказа, товар, артикул"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
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
        </div>
        <div className="warehouse-expected-supply__actions">
          <AppButton
            type="button"
            variant="secondary"
            disabled={!visibleOrders.length || query.isFetching}
            onClick={() =>
              setSelectedIds((current) =>
                Array.from(
                  new Set([
                    ...current,
                    ...visibleOrders.flatMap((order) =>
                      order.lines.map((line) => lineKey(order.document.id, line.productId)),
                    ),
                  ]),
                ),
              )
            }
          >
            Выбрать все найденные
          </AppButton>
          <AppButton type="button" variant="ghost" onClick={() => setSelectedIds([])}>
            Снять выделение
          </AppButton>
          <AppButton
            type="button"
            variant="ghost"
            onClick={() => setCollapsedIds(availableOrders.map((order) => order.document.id))}
          >
            Свернуть все
          </AppButton>
          <AppButton type="button" variant="ghost" onClick={() => setCollapsedIds([])}>
            Развернуть все
          </AppButton>
        </div>
        {query.isError ? (
          <AppAlert
            tone="danger"
            title="Не удалось загрузить остатки"
            onRetry={() => query.refetch()}
          />
        ) : query.isFetching ? (
          <p>Загружаем актуальные остатки…</p>
        ) : !visibleOrders.length ? (
          <div className="warehouse-remainder-picker__empty-state">
            <strong>Нет доступных остатков</strong>
            <span>
              Попробуйте изменить фильтр по контрагенту или снимите его, чтобы посмотреть все
              заказы.
            </span>
          </div>
        ) : (
          <AppTable
            className="warehouse-remainder-picker__table"
            headers={["Товар", "Доступно", "Перенести"]}
            body={visibleOrders.map((order) => {
              const collapsed = !search.trim() && collapsedIds.includes(order.document.id);
              const groupInvalid = order.lines.some((line) => {
                const key = lineKey(order.document.id, line.productId);
                return (
                  selectedIds.includes(key) &&
                  !validQuantity(Number(quantities[key] ?? line.quantity), line.quantity)
                );
              });
              return (
                <Fragment key={order.document.id}>
                  <tr
                    className="warehouse-remainder-picker__group-row"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        document: order.document,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  >
                    <td colSpan={3}>
                      <div className="warehouse-remainder-picker__group-header">
                        <AppButton
                          type="button"
                          variant="ghost"
                          aria-label={`${collapsed ? "Развернуть" : "Свернуть"} заказ ${order.document.documentNumber ?? ""}`}
                          aria-expanded={!collapsed}
                          onClick={() =>
                            setCollapsedIds((current) =>
                              collapsed
                                ? current.filter((id) => id !== order.document.id)
                                : [...current, order.document.id],
                            )
                          }
                        >
                          {collapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
                        </AppButton>
                        <AppCheckbox
                          label={`Заказ поставщику ${order.document.documentNumber ?? ""} · ${orderGroupSubtitle(order)}`}
                          checked={order.lines.every((line) =>
                            selectedIds.includes(lineKey(order.document.id, line.productId)),
                          )}
                          description={`Выбрано позиций: ${order.lines.filter((line) => selectedIds.includes(lineKey(order.document.id, line.productId))).length} из ${order.lines.length}`}
                          onCheckedChange={(checked) =>
                            selectLines(
                              order.lines.map((line) => lineKey(order.document.id, line.productId)),
                              checked,
                            )
                          }
                        />
                        {groupInvalid && (
                          <span className="warehouse-remainder-picker__group-error" role="alert">
                            Проверьте количество в выбранных позициях
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {!collapsed &&
                    order.lines.map((line) => {
                      const key = lineKey(order.document.id, line.productId);
                      const checked = selectedIds.includes(key);
                      const value = quantities[key] ?? String(line.quantity);
                      return (
                        <tr
                          key={key}
                          className={`warehouse-remainder-picker__product-row${checked ? " is-selected" : ""}`}
                          onClick={(event) => {
                            if (!isInteractiveRowTarget(event.target)) selectLines([key], !checked);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setContextMenu({
                              document: order.document,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                          <td>
                            <div className="warehouse-remainder-picker__product">
                              <AppCheckbox
                                label={line.productName}
                                description={`Артикул: ${line.sku}`}
                                checked={checked}
                                onCheckedChange={(next) => selectLines([key], next)}
                              />
                            </div>
                          </td>
                          <td>
                            <b>{line.quantity}</b>
                          </td>
                          <td>
                            <AppNumberInput
                              onFocus={selectNumericInputOnFocus}
                              aria-label={`Количество для переноса: ${line.productName}`}
                              min={0.001}
                              max={line.quantity}
                              step={0.001}
                              disabled={!checked}
                              value={value}
                              onChange={(event) =>
                                setQuantities((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              error={
                                checked && !validQuantity(Number(value), line.quantity)
                                  ? `От 0,001 до ${line.quantity}, не более 3 знаков после запятой`
                                  : undefined
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          />
        )}
      </div>
      <AppContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        label="Действия с заказом"
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setContextMenu(null);
        }}
        actions={
          contextMenu
            ? [
                {
                  label: "Открыть заказ",
                  icon: <Eye size={17} />,
                  onSelect: () => openDocument(contextMenu.document.id),
                },
              ]
            : []
        }
      />
      <div className="warehouse-remainder-picker__footer">
        <AppButton type="button" variant="ghost" onClick={() => close(false)}>
          Отмена
        </AppButton>
        <AppButton
          type="button"
          disabled={!selectedCount || hasInvalidQuantity || query.isFetching || query.isError}
          onClick={() => {
            if (hasInvalidQuantity || !selectedCount) return;
            onAdd(selected);
            close(false);
          }}
        >
          Добавить позиции: {selectedCount}
        </AppButton>
      </div>
    </AppModal>
  );
}
