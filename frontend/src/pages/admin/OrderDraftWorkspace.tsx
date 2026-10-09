import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { getBarcodeOrderCustomers } from "@/shared/api/barcodeOrders";
import { fetchRegularBuyers } from "@/shared/api/regularBuyers";
import { AppButton, AppActionMenu } from "@/shared/ui/AppButton";
import { AppAlert, AppModal, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppInput } from "@/shared/ui/AppField";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import {
  activateOrderDraftEntry,
  readOrderDraftWorkspace,
  removeOrderDraftEntry,
  writeOrderDraftEntry,
  type BarcodeOrderDraft,
  type OrderCreateMode,
  type OrderDraftEntry,
  type OrderDraftWorkspace as Workspace,
} from "./barcodeOrderDraft";
import "./OrderDraftWorkspace.css";

export type OrderDraftFormProps = {
  draftEntry: OrderDraftEntry;
  onSaveDraft: (id: string, data: BarcodeOrderDraft) => void;
  onDraftCreated: (id: string) => void;
  onNewDraft: () => void;
  renderDraftPanel: (busy: boolean) => ReactNode;
};

function emptyDraft(): BarcodeOrderDraft {
  const date = new Date();
  const orderDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
  return {
    lines: [],
    priceTier: "RETAIL",
    orderDate,
    selectedPriceLineIds: [],
    priceAdjustmentOperation: "PERCENT",
    priceAdjustmentValue: "",
    priceAdjustmentOriginalPrices: {},
    priceAdjustmentHistoryByLine: {},
    comment: "",
    selectedCustomerId: null,
    regularBuyerId: null,
    selectedPendingBinding: null,
  };
}

function newEntry(drafts: OrderDraftEntry[], assistantSessionId?: string): OrderDraftEntry {
  let number = 1;
  while (drafts.some((draft) => draft.title === `Заказ ${number}`)) number++;
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: `Заказ ${number}`,
    assistantSessionId,
    data: emptyDraft(),
  };
}

export function OrderDraftWorkspace({
  mode,
  children,
}: {
  mode: OrderCreateMode;
  children: (props: OrderDraftFormProps) => ReactNode;
}) {
  const { user } = useCommerce();
  const userId = user?.id;
  const location = useLocation();
  const navigate = useNavigate();
  const assistantParam = new URLSearchParams(location.search).get("assistantSession");
  const assistantSessionId =
    assistantParam &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assistantParam)
      ? assistantParam
      : undefined;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const pendingEntriesRef = useRef(new Map<string, OrderDraftEntry | null>());
  const pendingActiveRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete"; id: string } | null>(null);
  const [title, setTitle] = useState("");
  const canReadBuyers = user?.permissions.some((permission) =>
    ["regular-buyers.read", "regular-buyers.manage", "orders.update"].includes(permission),
  );
  const buyers = useQuery({
    queryKey: ["regular-buyers", "all"],
    queryFn: () => fetchRegularBuyers(true),
    enabled: Boolean(canReadBuyers),
  });

  const customers = useQuery({
    queryKey: ["users", "barcode-order-customer"],
    queryFn: getBarcodeOrderCustomers,
    enabled: Boolean(workspace?.drafts.some((draft) => draft.data.selectedCustomerId)),
  });

  useEffect(() => {
    const list = listRef.current;
    const card = activeCardRef.current;
    if (!list || !card) return;
    const left =
      card.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (left + card.offsetWidth > list.scrollLeft + list.clientWidth)
      list.scrollLeft = left + card.offsetWidth - list.clientWidth;
  }, [workspace?.activeId]);

  const updateWorkspace = useCallback((next: Workspace) => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);

  const flushPersistence = useCallback(() => {
    if (!userId) return false;
    // Retry every outstanding change before claiming that the workspace is saved.
    for (const [id, entry] of pendingEntriesRef.current) {
      const saved = entry
        ? writeOrderDraftEntry(userId, mode, entry)
        : removeOrderDraftEntry(userId, mode, id);
      if (saved) pendingEntriesRef.current.delete(id);
    }
    if (pendingActiveRef.current && activateOrderDraftEntry(userId, mode, pendingActiveRef.current))
      pendingActiveRef.current = null;
    const complete = !pendingEntriesRef.current.size && !pendingActiveRef.current;
    setStorageFailed(!complete);
    return complete;
  }, [userId, mode]);

  const refreshWorkspace = useCallback(
    (next: Workspace) => {
      const saved = flushPersistence();
      updateWorkspace(
        saved && userId ? { ...next, drafts: readOrderDraftWorkspace(userId, mode).drafts } : next,
      );
    },
    [flushPersistence, userId, mode, updateWorkspace],
  );

  useEffect(() => {
    if (!userId) return;
    const stored = readOrderDraftWorkspace(userId, mode);
    // Keep this session's drafts if persistence was unavailable.
    const current = workspaceRef.current ?? stored;
    let entry = assistantSessionId
      ? current.drafts.find((draft) => draft.assistantSessionId === assistantSessionId)
      : (current.drafts.find(
          (draft) => draft.id === current.activeId && !draft.assistantSessionId,
        ) ?? current.drafts.find((draft) => !draft.assistantSessionId));
    if (!entry) {
      entry = newEntry(current.drafts, assistantSessionId);
      pendingEntriesRef.current.set(entry.id, entry);
    }
    const drafts = current.drafts.some((draft) => draft.id === entry.id)
      ? current.drafts
      : [...current.drafts, entry];
    pendingActiveRef.current = entry.id;
    refreshWorkspace({ version: 2, drafts, activeId: entry.id });
  }, [userId, assistantSessionId, mode, refreshWorkspace]);

  const onSaveDraft = useCallback(
    (id: string, data: BarcodeOrderDraft) => {
      const current = workspaceRef.current;
      const entry = current?.drafts.find((draft) => draft.id === id);
      if (!userId || !current || !entry) return;
      const next = { ...entry, data: { ...data, savedAt: new Date().toISOString() } };
      pendingEntriesRef.current.set(id, next);
      refreshWorkspace({
        ...current,
        drafts: current.drafts.map((draft) => (draft.id === id ? next : draft)),
      });
    },
    [userId, refreshWorkspace],
  );

  const onDraftCreated = useCallback(
    (id: string) => {
      const current = workspaceRef.current;
      if (!userId || !current) return;
      pendingEntriesRef.current.set(id, null);
      const removed = flushPersistence();
      if (!removed)
        appToast.error(
          "Заказ создан, но браузер не смог сохранить изменения локальных черновиков.",
        );
      // The form navigates to the created order. Removing just this entry preserves the others.
      workspaceRef.current = {
        ...current,
        activeId: null,
        drafts: current.drafts.filter((draft) => draft.id !== id),
      };
    },
    [userId, flushPersistence],
  );

  function switchDraft(entry: OrderDraftEntry, drafts = workspaceRef.current?.drafts ?? []) {
    if (!userId || entry.id === workspaceRef.current?.activeId) return;
    // Another tab may have updated this draft since the last render. Load it before mounting the form.
    if (flushPersistence()) {
      drafts = readOrderDraftWorkspace(userId, mode).drafts;
      const fresh = drafts.find((draft) => draft.id === entry.id);
      if (!fresh) {
        appToast.info("Черновик уже удалён в другой вкладке");
        entry = drafts[0] ?? newEntry([]);
        if (!drafts.length) {
          pendingEntriesRef.current.set(entry.id, entry);
          drafts = [entry];
        }
      } else entry = fresh;
    }
    pendingActiveRef.current = entry.id;
    refreshWorkspace({ version: 2, activeId: entry.id, drafts });
    const params = new URLSearchParams(location.search);
    if (entry.assistantSessionId) params.set("assistantSession", entry.assistantSessionId);
    else params.delete("assistantSession");
    navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true, state: location.state },
    );
  }

  function onNewDraft() {
    const current = workspaceRef.current;
    if (!userId || !current) return;
    const entry = newEntry(current.drafts);
    pendingEntriesRef.current.set(entry.id, entry);
    switchDraft(entry, [...current.drafts, entry]);
  }

  function renameDraft() {
    const current = workspaceRef.current;
    const entry = current?.drafts.find((draft) => draft.id === dialog?.id);
    if (!userId || !current || !entry || !title.trim()) return;
    const latest = pendingEntriesRef.current.has(entry.id)
      ? entry
      : (readOrderDraftWorkspace(userId, mode).drafts.find((draft) => draft.id === entry.id) ??
        entry);
    const next = { ...latest, title: title.trim().slice(0, 120) };
    pendingEntriesRef.current.set(next.id, next);
    refreshWorkspace({
      ...current,
      drafts: current.drafts.map((draft) => (draft.id === next.id ? next : draft)),
    });
    setDialog(null);
  }

  function deleteDraft() {
    const current = workspaceRef.current;
    if (!userId || !current || !dialog) return;
    pendingEntriesRef.current.set(dialog.id, null);
    let drafts = current.drafts.filter((draft) => draft.id !== dialog.id);
    if (current.activeId === dialog.id) {
      const next = drafts[0] ?? newEntry([]);
      if (!drafts.length) {
        pendingEntriesRef.current.set(next.id, next);
        drafts = [next];
      }
      switchDraft(next, drafts);
    } else refreshWorkspace({ ...current, drafts });
    setDialog(null);
  }

  const active = workspace?.drafts.find((draft) => draft.id === workspace.activeId);
  if (!active) return <AppSkeleton />;

  function renderDraftPanel(busy: boolean) {
    return (
      <DataPanel
        title="Незавершённые заказы"
        className="order-drafts"
        size="compact"
        actions={
          <AppButton type="button" variant="secondary" disabled={busy} onClick={onNewDraft}>
            <Plus size={17} /> Новый заказ
          </AppButton>
        }
      >
        <p className="order-drafts__hint">
          Переключайтесь между заказами — товары, цены и покупатель сохраняются на этом устройстве.
        </p>
        {storageFailed && (
          <AppAlert
            title="Не удалось сохранить на устройстве"
            tone="warning"
            onRetry={() => {
              const current = workspaceRef.current;
              if (current) refreshWorkspace(current);
            }}
          >
            Несохранённые изменения остаются на этой странице. Освободите место в браузере или
            разрешите локальное хранение и повторите сохранение.
          </AppAlert>
        )}
        <div
          ref={listRef}
          className="order-drafts__list"
          role="group"
          aria-label="Переключение незавершённых заказов"
        >
          {workspace!.drafts.map((entry) => {
            const selected = entry.id === active!.id;
            const buyer =
              buyers.data?.find((buyer) => buyer.id === entry.data.regularBuyerId)?.name ??
              (entry.data.regularBuyerId
                ? "Постоянный покупатель"
                : (entry.data.selectedPendingBinding?.label ??
                  (entry.data.selectedCustomerId
                    ? (customers.data?.find(
                        (customer) => customer.id === entry.data.selectedCustomerId,
                      )?.name ?? "Клиент аккаунта")
                    : "Покупатель не выбран")));
            const missingPrice = entry.data.lines.some((line) => line.unitPrice === null);
            const total = entry.data.lines.reduce(
              (sum, line) => sum + (line.unitPrice ?? 0) * line.quantity,
              0,
            );
            return (
              <div
                key={entry.id}
                ref={selected ? activeCardRef : undefined}
                className={`order-drafts__card ${selected ? "is-active" : ""}`}
              >
                <AppButton
                  type="button"
                  variant="ghost"
                  className="order-drafts__switch"
                  aria-pressed={selected}
                  aria-label={`Открыть ${entry.title}`}
                  disabled={busy}
                  onClick={() => switchDraft(entry)}
                >
                  <span className="order-drafts__name">
                    <FileText size={17} />
                    <strong>{entry.title}</strong>
                    {selected && <span className="order-drafts__active">В работе</span>}
                  </span>
                  <span className="order-drafts__buyer">{buyer}</span>
                  <span className="order-drafts__summary">
                    {entry.data.lines.length} поз. ·{" "}
                    {missingPrice
                      ? "Цена не указана"
                      : `${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(total)} ₸`}
                    {entry.assistantSessionId && " · Из заявки"}
                  </span>
                </AppButton>
                <AppActionMenu
                  label={`Действия: ${entry.title}`}
                  actions={[
                    {
                      label: "Переименовать",
                      icon: <Pencil size={16} />,
                      disabled: busy,
                      onSelect: () => {
                        setTitle(entry.title);
                        setDialog({ kind: "rename", id: entry.id });
                      },
                    },
                    {
                      label: "Удалить черновик",
                      icon: <Trash2 size={16} />,
                      disabled: busy,
                      onSelect: () => setDialog({ kind: "delete", id: entry.id }),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
        <AppModal
          open={dialog !== null}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          title={dialog?.kind === "rename" ? "Название черновика" : "Удалить черновик?"}
          description={
            dialog?.kind === "delete"
              ? "Будет удалён только выбранный черновик на этом устройстве. Остальные заказы сохранятся."
              : undefined
          }
        >
          <form
            className="order-drafts__dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) {
                if (dialog?.kind === "rename") renameDraft();
                else deleteDraft();
              }
            }}
          >
            {dialog?.kind === "rename" && (
              <AppInput
                label="Название заказа"
                value={title}
                maxLength={120}
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
            <div className="order-drafts__actions">
              <AppButton type="button" variant="ghost" onClick={() => setDialog(null)}>
                Отмена
              </AppButton>
              <AppButton
                type="submit"
                variant={dialog?.kind === "delete" ? "danger" : "primary"}
                disabled={busy || (dialog?.kind === "rename" && !title.trim())}
              >
                {dialog?.kind === "rename" ? "Сохранить" : "Удалить черновик"}
              </AppButton>
            </div>
          </form>
        </AppModal>
      </DataPanel>
    );
  }

  return children({
    draftEntry: active,
    onSaveDraft,
    onDraftCreated,
    onNewDraft,
    renderDraftPanel,
  });
}
