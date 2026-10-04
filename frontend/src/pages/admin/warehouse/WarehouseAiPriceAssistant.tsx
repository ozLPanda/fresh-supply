import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, FileText, FolderPlus, PencilLine, Send } from "lucide-react";
import {
  type WarehouseDocument,
  type WarehousePriceSettingGroup,
  type WarehousePriceType,
  fetchWarehousePriceSettingGroups,
  updateWarehousePriceSettingGroup,
} from "@/shared/api/warehouse";
import { ApiError } from "@/shared/api/http";
import {
  AI_PRICE_TYPES,
  type AiPriceRow,
  type AiPriceSession,
  type AiPriceGroupSelection,
  createWarehouseAiPriceSession,
  fetchWarehouseAiPriceGroup,
  updateWarehouseAiPriceGroup,
  fetchWarehouseAiPriceSession,
  fetchWarehouseAiPricePreviewPdf,
  sendWarehouseAiPriceMessage,
  updateWarehouseAiPrices,
  confirmWarehouseAiPrices,
  regenerateWarehouseAiPrices,
} from "@/shared/api/warehouseAi";
import { AppButton } from "@/shared/ui/AppButton";
import { AppInput, AppSelect, AppTextarea } from "@/shared/ui/AppField";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppTable } from "@/shared/ui/AppTable";
import { appToast } from "@/shared/ui/AppToast";
import { AppRichTextEditor } from "@/shared/ui/AppRichTextEditor";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { selectNumericInputOnFocus } from "./selectNumericInputOnFocus";
import { WarehousePriceGroupCreateModal } from "./WarehousePriceGroupCreateModal";
import "./WarehouseAiPriceAssistant.css";
import "./WarehousePriceGroupModal.css";

const PRICE_LABELS: Record<WarehousePriceType, string> = {
  RETAIL: "Розничная",
  WHOLESALE: "Оптовая",
  BULK_WHOLESALE: "Крупно-оптовая",
  SKO: "СКО",
  GSKO: "ГСКО",
  INCOMING: "Приходная",
};
function rulesPlainText(value: string | null | undefined) {
  if (!value?.trim()) return "";
  if (typeof DOMParser === "undefined")
    return value
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .trim();
  const parsed = new DOMParser().parseFromString(value, "text/html");
  parsed.querySelectorAll("script, style, template").forEach((element) => element.remove());
  const blockTags = new Set([
    "DIV",
    "P",
    "LI",
    "UL",
    "OL",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BLOCKQUOTE",
  ]);
  function collect(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    if (element.tagName === "BR") return "\n";
    const content = Array.from(element.childNodes).map(collect).join("");
    return blockTags.has(element.tagName) ? `${content}\n` : content;
  }
  return Array.from(parsed.body.childNodes)
    .map(collect)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function rulesForAnalysis(value: string | null | undefined) {
  const rules = rulesPlainText(value);
  const historicalNote = /(?:^|\s)для\s+Дмитрия(?=\s|$)/iu.exec(rules);
  return (historicalNote ? rules.slice(0, historicalNote.index) : rules).trim();
}

const money = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value)} ₸`;
const quantity = (value: number) =>
  new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 3 }).format(value);
const parsePrice = (value: string) => {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isSafeInteger(number) && number > 0 ? number : NaN;
};
const priceChangePercent = (newPrice: number | null, oldPrice: number | null) =>
  newPrice !== null && Number.isFinite(newPrice) && oldPrice !== null && oldPrice !== 0
    ? ((newPrice - oldPrice) / oldPrice) * 100
    : null;
const percentFormatter = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 });

const applicablePriceTypes = (row: AiPriceRow) =>
  AI_PRICE_TYPES.filter((type) => row.prices[type] != null);
type DraftPrices = Record<number, Partial<Record<WarehousePriceType, string>>>;
function draftsFromSession(session: AiPriceSession): DraftPrices {
  return Object.fromEntries(
    session.rows.map((row) => [
      row.productId,
      Object.fromEntries(
        applicablePriceTypes(row).map((type) => [
          type,
          row.prices[type]?.newPrice == null ? "" : String(row.prices[type]?.newPrice),
        ]),
      ) as Partial<Record<WarehousePriceType, string>>,
    ]),
  );
}

export function WarehouseAiPriceAssistant({
  receipt,
  groups,
  open,
  onClose,
  onConfirmed,
}: {
  receipt: WarehouseDocument;
  groups: WarehousePriceSettingGroup[];
  open: boolean;
  onClose: () => void;
  onConfirmed: (documentIds: string[]) => void;
}) {
  const [groupId, setGroupId] = useState("");
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [rulesEditing, setRulesEditing] = useState(false);
  const [rulesDraft, setRulesDraft] = useState("");
  const [session, setSession] = useState<AiPriceSession | null>(null);
  const [drafts, setDrafts] = useState<DraftPrices>({});
  const [initialMessage, setInitialMessage] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<
    | "start"
    | "selection"
    | "selection-save"
    | "restore"
    | "message"
    | "save"
    | "confirm"
    | "regenerate"
    | null
  >(null);
  const [selectionSourceId, setSelectionSourceId] = useState<string | null>(null);
  const selectionRequestRef = useRef(0);
  const sourceContextRef = useRef({ receiptId: receipt.id, open });
  sourceContextRef.current = { receiptId: receipt.id, open };
  const [error, setError] = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [previewMode, setPreviewMode] = useState<"PDF" | "EDIT">("PDF");
  const [pdfLoading, setPdfLoading] = useState(false);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const isIncomingDraft = receipt.type === "PRICE_SETTING";
  const queryClient = useQueryClient();
  const saveGroupRules = useMutation({
    mutationFn: async ({ groupId, commonRules }: { groupId: string; commonRules: string }) => {
      const latest = (await fetchWarehousePriceSettingGroups()).find(
        (group) => group.id === groupId,
      );
      if (!latest) throw new Error("Группа установки цен больше не существует");
      return updateWarehousePriceSettingGroup(groupId, {
        name: latest.name,
        commonRules,
        comment: latest.comment,
      });
    },
    onSuccess: (group) => {
      queryClient.setQueryData<WarehousePriceSettingGroup[]>(
        ["warehouse-price-setting-groups"],
        (current = []) => current.map((item) => (item.id === group.id ? group : item)),
      );
      setRulesEditing(false);
      if (session && session.status !== "CONFIRMED" && session.groupId === group.id) {
        setSession(null);
        setDrafts({});
        setMessage("");
        setConfirmVisible(false);
        setError("");
        appToast.success("Правила обновлены. Запустите анализ заново");
      } else {
        appToast.success("Правила группы обновлены");
      }
    },
  });

  function submitRules() {
    if (!selectedGroup || saveGroupRules.isPending) return;
    saveGroupRules.mutate({ groupId: selectedGroup.id, commonRules: rulesDraft });
  }

  useEffect(() => {
    if (confirmVisible) confirmHeadingRef.current?.focus();
  }, [confirmVisible]);

  useEffect(() => {
    setInitialMessage("");
  }, [receipt.id]);

  function resetAnalysis() {
    setSession(null);
    setDrafts({});
    setMessage("");
    setConfirmVisible(false);
    setPreviewMode("PDF");
    setError("");
  }

  function selectionRequestIsCurrent(requestId: number, sourceId: string) {
    return (
      selectionRequestRef.current === requestId &&
      sourceContextRef.current.open &&
      sourceContextRef.current.receiptId === sourceId
    );
  }

  async function restoreSelection(
    selection: AiPriceGroupSelection,
    requestId: number,
    sourceId: string,
  ) {
    if (!selectionRequestIsCurrent(requestId, sourceId)) return;
    setGroupId(selection.groupId ?? "");
    setSelectionSourceId(sourceId);
    resetAnalysis();
    if (!selection.groupId || !selection.sessionId) return;
    setBusy("restore");
    try {
      const restored = await fetchWarehouseAiPriceSession(selection.sessionId);
      if (!selectionRequestIsCurrent(requestId, sourceId)) return;
      if (restored.receiptId !== sourceId || restored.groupId !== selection.groupId) return;
      setSession(restored);
      setDrafts(draftsFromSession(restored));
    } catch (cause) {
      if (!selectionRequestIsCurrent(requestId, sourceId)) return;
      setError(
        cause instanceof ApiError && cause.status === 404
          ? "Сеанс больше не существует. Можно начать новый."
          : "Не удалось восстановить сеанс. Повторите открытие помощника.",
      );
    }
  }

  useEffect(() => {
    const requestId = ++selectionRequestRef.current;
    if (!open) return;
    const sourceId = receipt.id;
    setGroupId("");
    setSelectionSourceId(null);
    resetAnalysis();
    setBusy("selection");
    fetchWarehouseAiPriceGroup(sourceId)
      .then((selection) => restoreSelection(selection, requestId, sourceId))
      .catch((cause) => {
        if (!selectionRequestIsCurrent(requestId, sourceId)) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось загрузить выбранную группу. Откройте помощника снова.",
        );
      })
      .finally(() => {
        if (selectionRequestIsCurrent(requestId, sourceId)) setBusy(null);
      });
    return () => {
      ++selectionRequestRef.current;
    };
  }, [open, receipt.id, receipt.priceSettingGroupId]);

  async function changeGroup(nextGroupId: string) {
    if (busy || unsaved || !open || selectionSourceId !== receipt.id) return;
    if (nextGroupId === groupId) return;
    const sourceId = receipt.id;
    const requestId = ++selectionRequestRef.current;
    setBusy("selection-save");
    setError("");
    try {
      const selection = await updateWarehouseAiPriceGroup(sourceId, nextGroupId || null);
      void queryClient.invalidateQueries({ queryKey: ["warehouse-price-setting-groups"] });
      await restoreSelection(selection, requestId, sourceId);
    } catch (cause) {
      if (selectionRequestIsCurrent(requestId, sourceId)) {
        setError(cause instanceof Error ? cause.message : "Не удалось сохранить выбранную группу.");
      }
    } finally {
      if (selectionRequestIsCurrent(requestId, sourceId)) setBusy(null);
    }
  }

  const selectionReady = selectionSourceId === receipt.id;

  const selectedGroup = groups.find((group) => group.id === groupId);
  const unsaved = useMemo(
    () =>
      Boolean(
        session?.status === "PREVIEW" &&
        session.rows.some((row) =>
          applicablePriceTypes(row).some(
            (type) =>
              drafts[row.productId]?.[type] !==
              (row.prices[type]?.newPrice == null ? "" : String(row.prices[type]?.newPrice)),
          ),
        ),
      ),
    [session, drafts],
  );
  const invalid = Boolean(
    session?.status === "PREVIEW" &&
    session.rows.some((row) =>
      applicablePriceTypes(row).some((type) => {
        const value = parsePrice(drafts[row.productId]?.[type] ?? "");
        return value === null || Number.isNaN(value);
      }),
    ),
  );

  function accept(next: AiPriceSession) {
    setSession(next);
    setDrafts(draftsFromSession(next));
    setError("");
  }

  async function run(
    kind: "start" | "message" | "save" | "confirm" | "regenerate",
    action: () => Promise<AiPriceSession>,
  ) {
    setBusy(kind);
    setError("");
    try {
      const next = await action();
      accept(next);
      if (kind === "start") setInitialMessage("");
      if (kind === "message" || kind === "regenerate") setMessage("");
      if (kind === "confirm") {
        setConfirmVisible(false);
        onConfirmed(next.createdDocumentIds);
      }
    } catch (cause) {
      if (
        kind === "regenerate" &&
        cause instanceof ApiError &&
        [400, 409].includes(cause.status) &&
        session
      ) {
        try {
          accept(await fetchWarehouseAiPriceSession(session.id));
        } catch {
          // The original API error remains visible if refreshing also fails.
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось выполнить действие. Повторите попытку.",
      );
    } finally {
      setBusy(null);
    }
  }

  function savePrices() {
    if (!session || invalid) return;
    const rows = session.rows
      .filter((row) => applicablePriceTypes(row).length > 0)
      .map((row) => ({
        productId: row.productId,
        prices: Object.fromEntries(
          applicablePriceTypes(row).map((type) => [
            type,
            parsePrice(drafts[row.productId]?.[type] ?? ""),
          ]),
        ) as Partial<Record<WarehousePriceType, number>>,
      }));
    void run("save", () => updateWarehouseAiPrices(session.id, rows));
  }

  function startAnalysis() {
    if (!selectionReady || !groupId || busy || session || initialMessage.length > 4000) return;
    void run("start", () => createWarehouseAiPriceSession(receipt.id, groupId, initialMessage));
  }

  function sendMessage() {
    if (!session || !message.trim() || unsaved) return;
    void run("message", () => sendWarehouseAiPriceMessage(session.id, message.trim()));
  }

  function regenerate() {
    if (!session || session.status !== "CONFIRMED" || !session.canRegenerate || busy) return;
    void run("regenerate", () => regenerateWarehouseAiPrices(session.id, message));
  }

  async function openPreviewPdf() {
    if (!session || session.status !== "PREVIEW" || unsaved || pdfLoading) return;
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      setError("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
      return;
    }
    previewWindow.document.title = "Формируем PDF…";
    previewWindow.document.body.textContent = "Формируем таблицу цен…";
    setPdfLoading(true);
    setError("");
    try {
      const url = URL.createObjectURL(await fetchWarehouseAiPricePreviewPdf(session.id));
      previewWindow.location.replace(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
    } catch (cause) {
      previewWindow.close();
      setError(cause instanceof Error ? cause.message : "Не удалось сформировать PDF-таблицу.");
    } finally {
      setPdfLoading(false);
    }
  }

  const scopeSummary = AI_PRICE_TYPES.map((type) => ({
    type,
    count: session?.rows.filter((row) => row.prices[type] != null).length ?? 0,
  })).filter((item) => item.count > 0);
  const additionalCatalogCount = session?.rows.filter((row) => row.catalogOnly).length ?? 0;
  const sourceRows = session?.rows.filter((row) => !row.catalogOnly) ?? [];
  const updatesIncomingSource =
    isIncomingDraft &&
    sourceRows.length > 0 &&
    sourceRows.every((row) => row.prices.INCOMING != null);
  const separateCatalogIncoming =
    updatesIncomingSource &&
    session?.rows.some((row) => row.catalogOnly && row.prices.INCOMING != null);
  const newDocumentCount =
    scopeSummary.length - (updatesIncomingSource ? 1 : 0) + (separateCatalogIncoming ? 1 : 0);

  const columns = [
    "Товар",
    "Кол-во",
    "Приход",
    ...AI_PRICE_TYPES.map((type) => PRICE_LABELS[type]),
  ];
  const tableRows = (session?.rows ?? []).map((row) => [
    <div className="warehouse-ai-price__product">
      <strong>{row.productName}</strong>
      {row.sku && <small>Артикул: {row.sku}</small>}
      {row.catalogOnly && <small>Из каталога, вне прихода</small>}
    </div>,
    row.catalogOnly ? "—" : quantity(row.quantity),
    money(row.unitCost),
    ...AI_PRICE_TYPES.map((type) => {
      const price = row.prices[type];
      if (!price) return <span title="Этот тип цены не меняется">—</span>;
      const draft = drafts[row.productId]?.[type] ?? "";
      const value = parsePrice(draft);
      const delta =
        value != null && Number.isFinite(value) && price.oldPrice != null && price.oldPrice !== 0
          ? ((value - price.oldPrice) / price.oldPrice) * 100
          : price.changePercent;
      return (
        <div className="warehouse-ai-price__cell" key={`${row.productId}-${type}`}>
          {session?.status === "PREVIEW" ? (
            <AppInput
              onFocus={selectNumericInputOnFocus}
              aria-label={`${PRICE_LABELS[type]}, ${row.productName}`}
              inputMode="decimal"
              value={draft}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [row.productId]: { ...current[row.productId], [type]: event.target.value },
                }))
              }
              className="warehouse-ai-price__price-input"
              aria-invalid={value === null || Number.isNaN(value)}
            />
          ) : (
            <strong>{money(price.newPrice)}</strong>
          )}
          <small>Было: {money(price.oldPrice)}</small>
          {delta != null && Number.isFinite(delta) && (
            <span
              className={`warehouse-ai-price__delta ${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}`}
            >
              {delta > 0 ? "+" : ""}
              {new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 1 }).format(delta)}%
            </span>
          )}
          {price.reason && (
            <small title={price.reason} className="warehouse-ai-price__reason">
              {price.reason}
            </small>
          )}
        </div>
      );
    }),
  ]);
  const comparisonHeaders = [
    "Артикул",
    "Товар",
    ...AI_PRICE_TYPES.map((type) => `Новая ${PRICE_LABELS[type]}`),
    ...AI_PRICE_TYPES.map((type) => `Старая ${PRICE_LABELS[type]}`),
  ];
  const comparisonSourceRows = [...(session?.rows ?? [])].sort((left, right) =>
    left.sku === null
      ? right.sku === null
        ? 0
        : 1
      : right.sku === null
        ? -1
        : left.sku.toLowerCase().localeCompare(right.sku.toLowerCase()),
  );
  const comparisonRows = comparisonSourceRows.map((row) => [
    row.sku || "—",
    <div className="warehouse-ai-price__product">
      <strong>{row.productName}</strong>
      {row.catalogOnly && <small>Из каталога, вне прихода</small>}
    </div>,
    ...AI_PRICE_TYPES.map((type) => {
      const price = row.prices[type];
      if (!price) return <span title="Этот тип цены не меняется">—</span>;
      const newPrice = parsePrice(drafts[row.productId]?.[type] ?? "");
      const change = priceChangePercent(newPrice, price.oldPrice);
      return (
        <div className="warehouse-ai-price__comparison-value" key={`${row.productId}-${type}-new`}>
          <strong>{Number.isNaN(newPrice) ? "—" : money(newPrice)}</strong>
          {change !== null && (
            <span className={change > 0 ? "is-up" : change < 0 ? "is-down" : ""}>
              {change >= 0 ? "+" : ""}
              {percentFormatter.format(change)}%
            </span>
          )}
        </div>
      );
    }),
    ...AI_PRICE_TYPES.map((type) => money(row.prices[type]?.oldPrice)),
  ]);
  const activeGeneratedDocumentIds = session?.activeGeneratedDocumentIds ?? [];
  const removedGeneratedDocumentCount =
    session?.createdDocumentIds.filter((id) => !activeGeneratedDocumentIds.includes(id)).length ??
    0;

  return (
    <>
      <AppModal
        open={open && !groupCreateOpen && !rulesEditing}
        onOpenChange={(next) => {
          if (!next && !groupCreateOpen && !rulesEditing) {
            setGroupCreateOpen(false);
            setRulesEditing(false);
            onClose();
          }
        }}
        title="Помощь ИИ с установкой цен"
        description="Агент изучит приход и правила группы. По вашему сообщению он может добавить товары из каталога и изменить только указанные типы цен."
        contentClassName="warehouse-ai-price"
      >
        <div className="warehouse-ai-price__body">
          <section className="warehouse-ai-price__setup" aria-label="Настройки расчёта">
            <AppSelect
              label="Группа установки цен"
              className="warehouse-ai-price__group-select"
              value={groupId}
              onChange={(event) => void changeGroup(event.target.value)}
              disabled={
                !selectionReady || Boolean(busy) || unsaved || isIncomingDraft || rulesEditing
              }
            >
              <option value="">Без группы</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </AppSelect>
            {unsaved && (
              <small className="warehouse-ai-price__group-hint">
                Сохраните изменения цен перед выбором другой группы.
              </small>
            )}
            {!isIncomingDraft && (
              <AppButton
                type="button"
                variant="secondary"
                disabled={!selectionReady || Boolean(busy) || unsaved || rulesEditing}
                aria-haspopup="dialog"
                aria-expanded={groupCreateOpen}
                onClick={() => setGroupCreateOpen(true)}
              >
                <FolderPlus size={17} /> Создать группу
              </AppButton>
            )}
          </section>
          {selectedGroup && (
            <div className="warehouse-ai-price__rules">
              <div className="warehouse-ai-price__rules-heading">
                <strong>Правила группы</strong>
                {!rulesEditing && (
                  <AppButton
                    type="button"
                    variant="ghost"
                    disabled={Boolean(busy) || unsaved}
                    onClick={() => {
                      setRulesDraft(selectedGroup.commonRules ?? "");
                      saveGroupRules.reset();
                      setRulesEditing(true);
                    }}
                  >
                    <PencilLine size={16} /> Изменить правила
                  </AppButton>
                )}
              </div>
              <p>{rulesForAnalysis(selectedGroup.commonRules) || "Общие правила не заданы."}</p>
              <small>
                По умолчанию: приходная и ГСКО — от чистой приходной из накладной; розница, крупный
                опт и СКО — от рассчитанной приходной; опт — от рассчитанной розницы. Исключения из
                правил группы меняют этот порядок.
              </small>
            </div>
          )}
          {selectionReady && !session && busy !== "restore" && (
            <form
              className="warehouse-ai-price__initial-message"
              onSubmit={(event) => {
                event.preventDefault();
                startAnalysis();
              }}
            >
              <AppTextarea
                label="Сообщение агенту перед расчётом (необязательно)"
                hint="Добавьте данные или исключения для этого расчёта. Они будут учтены вместе с правилами группы. До 4000 символов."
                value={initialMessage}
                onChange={(event) => setInitialMessage(event.target.value)}
                placeholder="Например: для мастер-флешей возьми старую розницу минус 10%. Выровняй цены внутри каждого размера независимо от цвета. Если старые цены отличаются, спроси, какую взять за основу."
                rows={4}
                maxLength={4000}
                disabled={Boolean(busy)}
              />
              <div className="warehouse-ai-price__initial-actions">
                <AppButton
                  type="submit"
                  disabled={
                    !selectionReady || !groupId || Boolean(busy) || groupCreateOpen || rulesEditing
                  }
                  loading={busy === "start"}
                >
                  <Bot size={17} /> Анализировать документ
                </AppButton>
              </div>
            </form>
          )}
          {error && (
            <AppAlert title="Ошибка" tone="danger">
              {error}
            </AppAlert>
          )}
          {busy === "selection" && <p role="status">Загружаем выбранную группу…</p>}
          {busy === "selection-save" && <p role="status">Сохраняем выбранную группу…</p>}
          {busy === "restore" && <p role="status">Восстанавливаем сеанс…</p>}
          {session && (
            <>
              <div className="warehouse-ai-price__status">
                <AppBadge
                  tone={
                    session.status === "CONFIRMED"
                      ? "green"
                      : session.status === "QUESTIONS"
                        ? "orange"
                        : "blue"
                  }
                >
                  {session.status === "QUESTIONS"
                    ? "Агент ждёт ответа"
                    : session.status === "PREVIEW"
                      ? "Черновик цен"
                      : "Документы созданы"}
                </AppBadge>
                <span>{session.groupName}</span>
              </div>
              {session.assistantMessage && (
                <AppAlert title="Результат анализа" tone="info">
                  {session.assistantMessage}
                </AppAlert>
              )}
              {session.status !== "QUESTIONS" && (
                <section className="warehouse-ai-price__scope" aria-label="Область расчёта">
                  <h3>Какие цены изменятся</h3>
                  <p>
                    {session.rows.length} товаров в расчёте
                    {additionalCatalogCount > 0 &&
                      `, из них ${additionalCatalogCount} добавлены из каталога вне прихода`}
                    . Прочерк в таблице означает, что этот тип цены не меняется.
                  </p>
                  <dl>
                    {scopeSummary.map(({ type, count }) => (
                      <div key={type}>
                        <dt>{PRICE_LABELS[type]}</dt>
                        <dd>{count} товаров</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {session.status === "PREVIEW" && (
                <section
                  className="warehouse-ai-price__pdf-callout"
                  aria-label="Предпросмотр PDF-таблицы цен"
                >
                  <div>
                    <h3>PDF-таблица предложенных цен</h3>
                    <p>
                      {session.rows.length} позиций · новые и старые цены по изменяемым типам, с
                      процентом изменения.
                      {unsaved
                        ? " Сохраните правки в таблице, чтобы увидеть их в PDF."
                        : " Документы будут созданы только после подтверждения."}
                    </p>
                  </div>
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={unsaved || Boolean(busy) || !session.rows.length || pdfLoading}
                    loading={pdfLoading}
                    onClick={() => void openPreviewPdf()}
                  >
                    <FileText size={17} /> Открыть PDF-таблицу
                  </AppButton>
                </section>
              )}
              {session.questions.length > 0 && session.status === "QUESTIONS" && (
                <section aria-label="Вопросы агента" className="warehouse-ai-price__questions">
                  <h3>Перед расчётом ответьте на вопросы</h3>
                  <ol>
                    {session.questions.map((question, index) => (
                      <li key={`${index}-${question}`}>{question}</li>
                    ))}
                  </ol>
                </section>
              )}
              {session.messages.length > 0 && (
                <section
                  className="warehouse-ai-price__conversation"
                  aria-label="Переписка с агентом"
                >
                  <h3>Переписка</h3>
                  <div className="warehouse-ai-price__messages" role="log" aria-live="polite">
                    {session.messages.map((item, index) => (
                      <div
                        key={index}
                        className={`warehouse-ai-price__message ${item.role === "user" ? "is-user" : "is-assistant"}`}
                      >
                        <strong>{item.role === "user" ? "Вы" : "Агент"}</strong>
                        <p>{item.content}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {session.status === "PREVIEW" && (
                <>
                  <section
                    className="warehouse-ai-price__preview"
                    aria-label="Временная таблица цен"
                  >
                    <div className="warehouse-ai-price__preview-heading">
                      <div>
                        <h3>Предложенные цены</h3>
                        <p>
                          {session.rows.length} позиций. В предпросмотре показаны текущие значения
                          таблицы и разница со старыми ценами.
                        </p>
                      </div>
                      <div className="warehouse-ai-price__preview-actions">
                        <SegmentedControl
                          ariaLabel="Вид таблицы цен"
                          items={[
                            { value: "PDF", label: "Сравнение цен" },
                            { value: "EDIT", label: "Редактирование" },
                          ]}
                          value={previewMode}
                          onValueChange={(value) => setPreviewMode(value as "PDF" | "EDIT")}
                        />
                        <AppBadge tone="orange">Черновик</AppBadge>
                      </div>
                    </div>
                    {session.rows.length ? (
                      <AppTable
                        headers={previewMode === "PDF" ? comparisonHeaders : columns}
                        rows={previewMode === "PDF" ? comparisonRows : tableRows}
                        className={
                          previewMode === "PDF" ? "warehouse-ai-price__comparison-table" : ""
                        }
                        rowKey={(_, index) =>
                          previewMode === "PDF"
                            ? comparisonSourceRows[index].productId
                            : session.rows[index].productId
                        }
                        size="compact"
                      />
                    ) : (
                      <AppAlert title="Нет позиций для расчёта" tone="warning">
                        Проверьте исходный документ и правила группы.
                      </AppAlert>
                    )}
                  </section>
                  {invalid && (
                    <p className="warehouse-ai-price__validation" role="alert">
                      Для каждого типа цены укажите целое число больше 0.
                    </p>
                  )}
                  {unsaved && (
                    <div className="warehouse-ai-price__save">
                      <span>Есть несохранённые изменения.</span>
                      <AppButton
                        type="button"
                        variant="secondary"
                        disabled={invalid || Boolean(busy)}
                        loading={busy === "save"}
                        onClick={savePrices}
                      >
                        <PencilLine size={16} /> Сохранить цены
                      </AppButton>
                    </div>
                  )}
                </>
              )}
              {session.status !== "CONFIRMED" && (
                <form
                  className="warehouse-ai-price__composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendMessage();
                  }}
                >
                  <AppTextarea
                    label={
                      session.status === "QUESTIONS" ? "Ответ агенту" : "Попросить изменить расчёт"
                    }
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={
                      session.status === "QUESTIONS"
                        ? "Ответьте на вопросы агента…"
                        : "Например: округли розничные цены до 10 ₸…"
                    }
                    rows={2}
                    disabled={Boolean(busy)}
                  />
                  <AppButton
                    type="submit"
                    variant="secondary"
                    disabled={!message.trim() || Boolean(busy) || unsaved}
                    loading={busy === "message"}
                  >
                    <Send size={16} /> Отправить
                  </AppButton>
                  {unsaved && <small>Сначала сохраните ручные изменения цен.</small>}
                </form>
              )}
              {session.status === "CONFIRMED" && (
                <div className="warehouse-ai-price__created">
                  {activeGeneratedDocumentIds.length > 0 ? (
                    <AppAlert title="Цены подтверждены" tone="success">
                      Действующих документов этого расчёта: {activeGeneratedDocumentIds.length}.
                    </AppAlert>
                  ) : (
                    <AppAlert title="Документы расчёта удалены" tone="info">
                      Действующих документов этого расчёта больше нет.
                    </AppAlert>
                  )}
                  {removedGeneratedDocumentCount > 0 && (
                    <p className="warehouse-ai-price__removed-status">
                      {isIncomingDraft &&
                      activeGeneratedDocumentIds.length === 1 &&
                      activeGeneratedDocumentIds[0] === receipt.id
                        ? `Остальные ${removedGeneratedDocumentCount} документов удалены; исходный документ остаётся.`
                        : `Удалено документов этого расчёта: ${removedGeneratedDocumentCount}.`}
                    </p>
                  )}
                  {activeGeneratedDocumentIds.map((id, index) => (
                    <Link
                      key={id}
                      to={`/admin/warehouse/documents/${id}`}
                      state={{ returnTo: `/admin/warehouse/documents/${receipt.id}` }}
                      onClick={onClose}
                    >
                      {isIncomingDraft && id === receipt.id
                        ? "Открыть исходный документ"
                        : `Открыть документ ${index + 1}`}
                    </Link>
                  ))}
                  {session.canRegenerate ? (
                    <div className="warehouse-ai-price__regenerate">
                      <AppTextarea
                        label="Пожелание для повторного расчёта (необязательно)"
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        placeholder="Например: пересчитай цены с округлением до 10 ₸…"
                        rows={2}
                        disabled={Boolean(busy)}
                      />
                      <AppButton
                        type="button"
                        loading={busy === "regenerate"}
                        disabled={Boolean(busy)}
                        onClick={regenerate}
                      >
                        <Bot size={17} /> Сгенерировать заново
                      </AppButton>
                    </div>
                  ) : (
                    <AppAlert title="Повторный расчёт пока недоступен" tone="warning">
                      {activeGeneratedDocumentIds.length > 0
                        ? `Удалите действующие документы этого расчёта (${activeGeneratedDocumentIds.length}), затем откройте помощника снова.`
                        : "Обновите помощника позже или проверьте состояние исходного документа."}
                    </AppAlert>
                  )}
                </div>
              )}
            </>
          )}
          {confirmVisible && session?.status === "PREVIEW" && (
            <section
              className="warehouse-ai-price__confirm"
              aria-labelledby="warehouse-ai-confirm-title"
            >
              <div className="warehouse-ai-price__confirm-card">
                <h3 id="warehouse-ai-confirm-title" tabIndex={-1} ref={confirmHeadingRef}>
                  Подтвердить цены?
                </h3>
                <p id="warehouse-ai-confirm-description">
                  {isIncomingDraft
                    ? updatesIncomingSource
                      ? `Агент обновит этот документ «Приходная» и создаст ещё ${newDocumentCount} документов в группе «${session.groupName}».`
                      : `Агент создаст ${newDocumentCount} документов в группе «${session.groupName}».`
                    : `Агент создаст в группе «${session.groupName}» ${newDocumentCount} документов установки цен.`}{" "}
                  В каждом документе будут только товары, для которых указан соответствующий тип
                  цены. Проверьте все цены перед подтверждением.
                </p>
                <div>
                  <AppButton
                    type="button"
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={() => setConfirmVisible(false)}
                  >
                    Вернуться к таблице
                  </AppButton>
                  <AppButton
                    type="button"
                    disabled={Boolean(busy)}
                    loading={busy === "confirm"}
                    onClick={() => void run("confirm", () => confirmWarehouseAiPrices(session.id))}
                  >
                    Подтвердить и создать
                  </AppButton>
                </div>
              </div>
            </section>
          )}
        </div>
        <div className="warehouse-ai-price__footer">
          <AppButton
            type="button"
            variant="ghost"
            onClick={() => {
              setGroupCreateOpen(false);
              setRulesEditing(false);
              onClose();
            }}
          >
            Закрыть
          </AppButton>
          {session?.status === "PREVIEW" && !confirmVisible && (
            <AppButton
              type="button"
              disabled={!session.rows.length || invalid || unsaved || Boolean(busy)}
              onClick={() => setConfirmVisible(true)}
            >
              <CheckCircle2 size={17} /> Создать 6 документов
            </AppButton>
          )}
        </div>
      </AppModal>
      <WarehousePriceGroupCreateModal
        open={open && groupCreateOpen}
        onOpenChange={setGroupCreateOpen}
        onCreated={(group) => void changeGroup(group.id)}
      />
      <AppModal
        open={open && rulesEditing}
        onOpenChange={(next) => {
          if (!next && saveGroupRules.isPending) return;
          setRulesEditing(next);
        }}
        title="Изменить правила группы"
        description={`Группа «${selectedGroup?.name ?? ""}». Обновлённые правила применятся при новом анализе документа.`}
        contentClassName="warehouse-price-group-modal"
      >
        <div className="warehouse-price-group-modal__form">
          <AppRichTextEditor
            label="Правила установки цен"
            value={rulesDraft}
            placeholder="Опишите правила, исключения и формулы для цен этой группы."
            onValueChange={setRulesDraft}
          />
          {saveGroupRules.error && (
            <AppAlert title="Не удалось сохранить правила" tone="danger">
              {saveGroupRules.error instanceof Error
                ? saveGroupRules.error.message
                : "Повторите попытку позже"}
            </AppAlert>
          )}
          <div className="warehouse-price-group-modal__actions">
            <AppButton
              type="button"
              variant="ghost"
              disabled={saveGroupRules.isPending}
              onClick={() => setRulesEditing(false)}
            >
              Отмена
            </AppButton>
            <AppButton type="button" loading={saveGroupRules.isPending} onClick={submitRules}>
              Сохранить правила
            </AppButton>
          </div>
        </div>
      </AppModal>
    </>
  );
}
