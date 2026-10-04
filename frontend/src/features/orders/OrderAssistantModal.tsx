import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import {
  ArrowUpRight,
  Check,
  ClipboardPen,
  ImagePlus,
  LoaderCircle,
  Send,
  Sparkles,
} from "lucide-react";
import {
  answerOrderAssistantQuestion,
  selectOrderAssistantBuyer,
  applyOrderAssistant,
  createOrderAssistantSession,
  getOrderAssistantSession,
  sendOrderAssistantMessage,
  updateOrderAssistantItems,
  type OrderAssistantItem,
  type OrderAssistantContext,
  type OrderAssistantSession,
} from "@/shared/api/orderAssistant";
import { AppCheckbox } from "@/shared/ui/AppControls";
import { AppButton } from "@/shared/ui/AppButton";
import { AppAlert, AppModal, AppTooltip } from "@/shared/ui/AppFeedback";
import { AppInput, AppSelect, AppTextarea } from "@/shared/ui/AppField";
import { measurementUnitLabel } from "@/shared/lib/measurementUnit";
import { RegularBuyerSelect } from "./RegularBuyerSelect";
import { PRICE_TIER_LABELS } from "./price-tier";
import {
  OrderAssistantPhotos,
  prepareOrderPhoto,
  MAX_ASSISTANT_PHOTOS,
  type PendingOrderPhoto,
} from "./OrderAssistantPhotos";
import { OrderAssistantItemsEditor } from "./OrderAssistantItemsEditor";
import "./OrderAssistantModal.css";

type ControlAnswer =
  | { kind: "choice"; answerId: string }
  | { kind: "buyer"; regularBuyerId: string | null };
type PendingAnswer = { action: ControlAnswer; sessionId: string; revision: number };
const questionKey = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");

const quantity = (value: number) =>
  new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 3 }).format(value);

export function OrderAssistantModal({
  open,
  onOpenChange,
  context,
  onApplied,
  onOpenOrder,
  onReviewDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: OrderAssistantContext;
  onApplied: (session: OrderAssistantSession) => void | Promise<void>;
  onOpenOrder?: (orderId: string) => void;
  onReviewDraft?: (sessionId: string) => void;
}) {
  const { user } = useCommerce();
  const queryClient = useQueryClient();
  const storageKey = user?.id ? `order-assistant-active:${user.id}` : null;
  const resumeChecked = useRef(false);
  function persistSession(id: string | null) {
    if (context.mode !== "CREATE" || !storageKey) return;
    try {
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Chat still works when storage is unavailable. */
    }
  }
  const [session, setSession] = useState<OrderAssistantSession | null>(null);
  const [previousSessions, setPreviousSessions] = useState<OrderAssistantSession[]>([]);
  const [allowStockShortage, setAllowStockShortage] = useState(false);
  const [photosReviewed, setPhotosReviewed] = useState(false);
  useEffect(() => setPhotosReviewed(false), [session?.id, session?.revision]);
  useEffect(() => setAllowStockShortage(false), [session?.id, session?.revision]);
  const [message, setMessage] = useState("");
  const [photos, setPhotos] = useState<PendingOrderPhoto[]>([]);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const preparingPhotosRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "apply" | "reload" | "answer" | "edit" | null>(null);
  const busyRef = useRef(false);
  const [pendingAnswer, setPendingAnswer] = useState<PendingAnswer | null>(null);
  const [failedAnswer, setFailedAnswer] = useState<PendingAnswer | null>(null);
  const [buyerDraft, setBuyerDraft] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setFailedAnswer(null);
    setBuyerDraft(undefined);
  }, [session?.id, session?.revision]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [priceTier, setPriceTier] = useState(context.priceTier);
  const [orderDate, setOrderDate] = useState(context.orderDate);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const messages = endRef.current?.parentElement;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [session?.messages.length, pendingMessage, busy]);

  useEffect(() => {
    if (!open || context.mode !== "CREATE" || resumeChecked.current || !storageKey) return;
    resumeChecked.current = true;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(storageKey);
    } catch {
      return;
    }
    if (!id) return;
    busyRef.current = true;
    setBusy("reload");
    void getOrderAssistantSession(id)
      .then(setSession)
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось восстановить диалог. Начните новую заявку.",
        );
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Storage is optional. */
        }
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(null);
      });
  }, [open, context.mode, storageKey]);

  async function switchSession(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("reload");
    setError(null);
    try {
      const selected = await getOrderAssistantSession(id);
      if (session)
        setPreviousSessions((current) => [
          ...current.filter((item) => item.id !== session.id),
          session,
        ]);
      setSession(selected);
      persistSession(selected.id);
      setMessage("");
      setPhotos([]);
      setEditing(false);
      setSuccess(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось открыть диалог");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function answer(action: ControlAnswer) {
    if (!session || busyRef.current) return;
    const current = session;
    const request = { action, sessionId: current.id, revision: current.revision };
    busyRef.current = true;
    setBusy("answer");
    setPendingAnswer(request);
    setFailedAnswer(null);
    setError(null);
    setSuccess(null);
    if (action.kind === "buyer") setBuyerDraft(action.regularBuyerId);
    try {
      const next =
        action.kind === "choice"
          ? await answerOrderAssistantQuestion(current.id, action.answerId, current.revision)
          : await selectOrderAssistantBuyer(current.id, action.regularBuyerId, current.revision);
      setSession(next);
      setBuyerDraft(undefined);
      void queryClient.invalidateQueries({ queryKey: ["regular-buyers"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить ответ");
      setFailedAnswer(request);
      // Recover a committed response after a connection failure before offering a retry.
      try {
        const latest = await getOrderAssistantSession(current.id);
        if (latest.revision !== current.revision) {
          setSession(latest);
          setFailedAnswer(null);
          setBuyerDraft(undefined);
          setError(null);
          setSuccess("Состояние диалога обновлено. Проверьте текущий состав и вопросы.");
        }
      } catch {
        /* Keep the selected answer and text available for retry. */
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
      setPendingAnswer(null);
    }
  }

  async function addPhotos(files: File[]) {
    if (busyRef.current || preparingPhotosRef.current || editing) return;
    const count = (session?.attachments?.length ?? 0) + photos.length;
    if (count + files.length > MAX_ASSISTANT_PHOTOS) {
      setError(`В одном диалоге можно использовать до ${MAX_ASSISTANT_PHOTOS} фотографий.`);
      return;
    }
    preparingPhotosRef.current = true;
    setPreparingPhotos(true);
    setError(null);
    try {
      const prepared = [] as PendingOrderPhoto[];
      for (const file of files) prepared.push(await prepareOrderPhoto(file));
      const all = [...(session?.attachments ?? []), ...photos, ...prepared];
      if (all.reduce((total, photo) => total + photo.dataUrl.length * 0.75, 0) > 24 * 1024 * 1024)
        throw new Error(
          "Суммарный размер фотографий превышает 24 МБ. Загрузите меньшие изображения.",
        );
      setPhotos((current) => [...current, ...prepared]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось прочитать фотографию");
    } finally {
      preparingPhotosRef.current = false;
      setPreparingPhotos(false);
    }
  }

  async function saveItems(items: OrderAssistantItem[]) {
    if (!session || busyRef.current) return false;
    busyRef.current = true;
    setBusy("edit");
    setError(null);
    setSuccess(null);
    try {
      setSession(await updateOrderAssistantItems(session.id, session.revision, items));
      setSuccess("Состав исправлен. Помощник учтёт эти изменения в следующих сообщениях.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить состав");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function run(action: "send" | "apply" | "reload") {
    if (
      busyRef.current ||
      preparingPhotosRef.current ||
      editing ||
      (action === "apply" && Boolean(session?.attachments?.length) && !photosReviewed) ||
      (action === "send" && !message.trim() && !photos.length)
    )
      return;
    busyRef.current = true;
    setBusy(action);
    setError(null);
    setSuccess(null);
    setFailedAnswer(null);
    if (action !== "apply") setBuyerDraft(undefined);
    const outgoingMessage = action === "send" ? message.trim() : null;
    let sentFrom: OrderAssistantSession | null = null;
    if (outgoingMessage !== null) {
      setPendingMessage(outgoingMessage || `Отправлены фотографии: ${photos.length}`);
      setMessage("");
    }
    try {
      if (action === "send") {
        const current =
          session ??
          (await createOrderAssistantSession(
            context.mode === "DRAFT" ? context : { ...context, priceTier, orderDate },
          ));
        setSession(current);
        persistSession(current.id);
        sentFrom = current;
        const next = await sendOrderAssistantMessage(
          current.id,
          outgoingMessage!,
          current.revision,
          photos.map(({ name, dataUrl }) => ({ name, dataUrl })),
        );
        setPhotos([]);
        setSession(next);
        setPendingMessage(null);
        void queryClient.invalidateQueries({ queryKey: ["regular-buyers"] });
      } else if (session && action === "apply") {
        const next = await applyOrderAssistant(
          session.id,
          session.revision,
          context.mode === "CREATE" && allowStockShortage,
        );
        await onApplied(next);
        setSession(next);
        setSuccess(
          next.mode === "DRAFT"
            ? "Состав перенесён в форму. Заказ сохранится после оформления."
            : "Заказ сохранён. Можно написать правки ниже.",
        );
      } else if (session) {
        setSession(await getOrderAssistantSession(session.id));
      }
    } catch (cause) {
      // A response can be lost after the server has already saved the turn.
      // Reconcile before returning the text for another attempt.
      if (outgoingMessage !== null && sentFrom) {
        try {
          const latest = await getOrderAssistantSession(sentFrom.id);
          setSession(latest);
          const savedMessage = latest.messages[sentFrom.messages.length];
          if (
            latest.revision > sentFrom.revision &&
            savedMessage?.role.toLowerCase() === "user" &&
            (photos.length > 0
              ? (latest.attachments?.length ?? 0) ===
                  (sentFrom.attachments?.length ?? 0) + photos.length &&
                photos.every(
                  (photo, index) =>
                    latest.attachments?.[(sentFrom!.attachments?.length ?? 0) + index]?.dataUrl ===
                    photo.dataUrl,
                )
              : savedMessage.content === outgoingMessage)
          ) {
            setPhotos([]);
            void queryClient.invalidateQueries({ queryKey: ["regular-buyers"] });
            return;
          }
        } catch {
          /* The input is restored below when recovery is unavailable. */
        }
      }
      if (outgoingMessage !== null) setMessage(outgoingMessage);
      setError(cause instanceof Error ? cause.message : "Не удалось связаться с помощником");
    } finally {
      setPendingMessage(null);
      busyRef.current = false;
      setBusy(null);
    }
  }

  const applied = session && session.appliedRevision === session.revision;
  const clarifications = session?.proposal.clarifications ?? [];
  const buyerQuestions = clarifications.filter((item) => item.kind === "BUYER");
  const choiceQuestions = clarifications.filter((item) => item.kind === "CHOICE");
  const structuredQuestions = new Set(clarifications.map((item) => questionKey(item.question)));
  const fallbackQuestions = [...new Set(session?.proposal.questions ?? [])].filter(
    (question) => !structuredQuestions.has(questionKey(question)),
  );
  const canRetryAnswer =
    failedAnswer &&
    failedAnswer.sessionId === session?.id &&
    failedAnswer.revision === session?.revision;
  return (
    <AppModal
      open={open}
      onOpenChange={(value) => {
        if (!busyRef.current && !preparingPhotosRef.current && !editing) onOpenChange(value);
      }}
      title={session?.orderId ? "Помощник · созданный заказ" : "Помощник по заказам"}
      description="Прикрепите фотографии или вставьте заявку. Помощник учтёт количество, зачёркивания и ваши уточнения. Состав можно исправить вручную."
      contentClassName="order-assistant"
    >
      <div className="order-assistant__body">
        {context.mode === "CREATE" && (session || previousSessions.length > 0) && (
          <div className="order-assistant__sessions">
            {previousSessions.length > 0 && (
              <AppSelect
                label="Диалог"
                value={session?.id || "new"}
                clearable={false}
                disabled={Boolean(busy) || preparingPhotos || editing}
                options={[
                  ...previousSessions.filter((item) => item.id !== session?.id),
                  ...(session ? [session] : []),
                ]
                  .map((item, index) => ({
                    value: item.id,
                    label: item.orderId
                      ? `Созданный заказ · диалог ${index + 1}`
                      : `Черновик · диалог ${index + 1}`,
                  }))
                  .concat(session ? [] : [{ value: "new", label: "Новая заявка" }])}
                onValueChange={(value) => {
                  if (
                    typeof value === "string" &&
                    previousSessions.some((item) => item.id === value)
                  )
                    void switchSession(value);
                }}
              />
            )}
            <AppButton
              type="button"
              variant="secondary"
              disabled={Boolean(busy) || preparingPhotos || editing || !session}
              onClick={() => {
                if (session)
                  setPreviousSessions((current) => [
                    ...current.filter((item) => item.id !== session.id),
                    session,
                  ]);
                setPhotos([]);
                setEditing(false);
                setSession(null);
                persistSession(null);
                setMessage("");
                void queryClient.invalidateQueries({ queryKey: ["regular-buyers"] });
                setError(null);
                setSuccess(null);
              }}
            >
              Новая заявка
            </AppButton>
          </div>
        )}
        {context.mode === "CREATE" && !session && (
          <div className="order-assistant__settings">
            <AppSelect
              label="Тип продажи"
              value={priceTier}
              clearable={false}
              options={Object.entries(PRICE_TIER_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              onValueChange={(value) => setPriceTier(value as typeof priceTier)}
              disabled={Boolean(busy) || preparingPhotos || editing}
            />
            <AppInput
              label="Дата заказа"
              type="date"
              value={orderDate}
              required
              disabled={Boolean(busy) || preparingPhotos || editing}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </div>
        )}
        <div className="order-assistant__workspace">
          <section className="order-assistant__conversation" aria-label="Переписка с помощником">
            <div
              className="order-assistant__messages"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {!session?.messages.length && pendingMessage === null && (
                <div className="order-assistant__welcome">
                  <Sparkles size={24} />
                  <strong>Соберём заказ из текста или фотографий</strong>
                  <p>
                    Например: «Викинг, картофель 10 кг, яйца 60 шт». Укажите поставщика, если он
                    известен. Неоднозначные товары и единицы уточним перед добавлением.
                  </p>
                  <p>
                    {context.mode === "DRAFT"
                      ? "Текущие позиции формы войдут в черновик. Пишите, что добавить или изменить."
                      : "После создания можно исправлять этот заказ в том же чате."}
                  </p>
                </div>
              )}
              {session?.messages.map((entry, index) => (
                <article
                  key={index}
                  className={`order-assistant__message ${entry.role.toLowerCase() === "user" ? "is-user" : ""}`}
                >
                  <strong>{entry.role.toLowerCase() === "user" ? "Вы" : "Помощник"}</strong>
                  <p>{entry.content}</p>
                </article>
              ))}
              {pendingMessage !== null && (
                <article className="order-assistant__message is-user">
                  <strong>Вы</strong>
                  <p>{pendingMessage || `Прикреплено фото: ${photos.length}`}</p>
                </article>
              )}
              {busy === "send" && (
                <article className="order-assistant__message" role="status">
                  <strong>Помощник</strong>
                  <p className="order-assistant__pending">
                    <LoaderCircle size={16} className="app-spinner" aria-hidden="true" />
                    <span>
                      {photos.length || session?.attachments?.length
                        ? "Читаю фотографии и перепроверяю позиции…"
                        : "Готовлю ответ…"}
                    </span>
                  </p>
                </article>
              )}
              <div ref={endRef} />
            </div>
            <OrderAssistantPhotos photos={session?.attachments ?? []} />
            <div
              className="order-assistant__composer"
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter((file) =>
                  file.type.startsWith("image/"),
                );
                if (files.length) {
                  event.preventDefault();
                  void addPhotos(files);
                }
              }}
            >
              <OrderAssistantPhotos
                photos={photos.map((photo, index) => ({
                  ...photo,
                  number: (session?.attachments?.length ?? 0) + index + 1,
                }))}
                pending
                disabled={Boolean(busy) || preparingPhotos || editing}
                onRemove={(id) =>
                  setPhotos((current) => current.filter((photo) => photo.id !== id))
                }
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  void addPhotos(files);
                }}
              />
              <AppTextarea
                ref={inputRef}
                label="Сообщение помощнику"
                rows={4}
                hint="Например: «На 1 фотографии возьми только левый столбец». Фото остаются в диалоге — прикреплять их повторно не нужно."
                value={message}
                maxLength={20000}
                disabled={Boolean(busy) || preparingPhotos || editing}
                placeholder={
                  session
                    ? "Уточните выбор или напишите правки…"
                    : "Вставьте заявку с товарами и количеством…"
                }
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void run("send");
                  }
                }}
              />
              <div className="order-assistant__send">
                <span>Ctrl / ⌘ + Enter — отправить</span>
                <div className="order-assistant__send-actions">
                  <AppTooltip content="Прикрепить фотографии · JPEG, PNG, WebP · до 8 фото. Можно вставить через Ctrl / ⌘ + V.">
                    <AppButton
                      type="button"
                      variant="secondary"
                      className="order-assistant__attach"
                      aria-label="Прикрепить фотографии"
                      disabled={
                        Boolean(busy) ||
                        preparingPhotos ||
                        editing ||
                        (session?.attachments?.length ?? 0) + photos.length >= MAX_ASSISTANT_PHOTOS
                      }
                      loading={preparingPhotos}
                      loadingMode="spinner-only"
                      onClick={() => fileRef.current?.click()}
                    >
                      <ImagePlus size={19} aria-hidden="true" />
                    </AppButton>
                  </AppTooltip>
                  <AppButton
                    type="button"
                    disabled={
                      (!message.trim() && !photos.length) ||
                      !orderDate ||
                      Boolean(busy) ||
                      preparingPhotos ||
                      editing
                    }
                    loading={busy === "send"}
                    loadingText="Ожидание ответа"
                    onClick={() => void run("send")}
                  >
                    <Send size={16} />
                    Отправить
                  </AppButton>
                </div>
              </div>
            </div>
          </section>
          {session && (
            <section className="order-assistant__preview" aria-label="Предложенный состав заказа">
              <div className="order-assistant__preview-heading">
                <strong>Состав заказа</strong>
                <span>{session.proposal.items.length} поз.</span>
              </div>
              <section className="order-assistant__buyer" aria-label="Выбор покупателя">
                {buyerQuestions.map((question) => (
                  <p key={question.id} className="order-assistant__buyer-question">
                    {question.question}
                  </p>
                ))}
                <RegularBuyerSelect
                  value={buyerDraft === undefined ? session.proposal.regularBuyerId : buyerDraft}
                  currentName={session.proposal.regularBuyerName}
                  disabled={Boolean(busy) || preparingPhotos || editing}
                  unresolved={buyerQuestions.length > 0 && buyerDraft === undefined}
                  hint="Найдите по официальному названию или названию в заявке. Выбор сразу передаётся помощнику."
                  onChange={(regularBuyerId) => void answer({ kind: "buyer", regularBuyerId })}
                />
                {failedAnswer?.action.kind === "buyer" && (
                  <span className="order-assistant__buyer-account">
                    Выбор ещё не подтверждён. Повторите выбранный ответ ниже.
                  </span>
                )}
                {session.proposal.customerId && (
                  <span className="order-assistant__buyer-account">
                    Пользователь заказа: №{session.proposal.customerId}
                  </span>
                )}
              </section>
              <dl className="order-assistant__details">
                <div>
                  <dt>Поставщик</dt>
                  <dd>
                    {session.proposal.supplierName || "Не выбран"}
                    {session.proposal.supplierName && (
                      <small className="order-assistant__supplier-note">
                        Поставщик будет указан в комментарии заказа.
                      </small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Тип продажи</dt>
                  <dd>{PRICE_TIER_LABELS[session.priceTier]}</dd>
                </div>
              </dl>
              {(choiceQuestions.length > 0 || fallbackQuestions.length > 0) && (
                <section className="order-assistant__questions" aria-label="Уточнения по заявке">
                  <strong className="order-assistant__questions-heading">Нужно уточнить</strong>
                  {choiceQuestions.map((question) => (
                    <div
                      key={`${session.id}:${session.revision}:${question.id}`}
                      className="order-assistant__question"
                      role="group"
                      aria-labelledby={`assistant-question-${session.id}-${question.id}`}
                      aria-busy={Boolean(busy)}
                    >
                      <p
                        className="order-assistant__question-title"
                        id={`assistant-question-${session.id}-${question.id}`}
                      >
                        {question.question}
                      </p>
                      {question.options.length > 0 && (
                        <div className="order-assistant__options">
                          {question.options.map((option) => (
                            <AppButton
                              key={option.id}
                              type="button"
                              variant="secondary"
                              className="order-assistant__option"
                              disabled={Boolean(busy) || preparingPhotos || editing}
                              loading={
                                busy === "answer" &&
                                pendingAnswer?.action.kind === "choice" &&
                                pendingAnswer.action.answerId === option.id
                              }
                              onClick={() => void answer({ kind: "choice", answerId: option.id })}
                            >
                              {option.label}
                            </AppButton>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {fallbackQuestions.map((question) => (
                    <article className="order-assistant__question" key={question}>
                      <p className="order-assistant__question-title">{question}</p>
                    </article>
                  ))}
                  <p className="order-assistant__questions-hint">
                    {choiceQuestions.some((question) => question.options.length > 0)
                      ? "Выберите вариант или напишите свой ответ в чате."
                      : "Ответьте на уточнения в чате."}
                  </p>
                </section>
              )}
              <OrderAssistantItemsEditor
                key={session.id}
                session={session}
                disabled={Boolean(busy) || preparingPhotos}
                onSave={saveItems}
                onEditingChange={setEditing}
              />
              {!editing && (
                <ol className="order-assistant__items">
                  {session.proposal.items.map((item, index) => (
                    <li key={index} className={item.issue ? "has-issue" : ""}>
                      <strong>{item.name || item.source}</strong>
                      {item.source && item.source !== item.name && (
                        <span>Из заявки: {item.source}</span>
                      )}
                      <div>
                        {item.quantity == null
                          ? "Количество не определено"
                          : quantity(item.quantity)}{" "}
                        {item.measurementUnit ? measurementUnitLabel(item.measurementUnit) : ""}
                        {item.unitPrice != null && (
                          <span>
                            {" "}
                            · {quantity(item.unitPrice)} ₸ /{" "}
                            {item.measurementUnit
                              ? measurementUnitLabel(item.measurementUnit)
                              : "ед."}
                          </span>
                        )}
                      </div>
                      {item.issue && <p>{item.issue}</p>}
                    </li>
                  ))}
                </ol>
              )}
              {session.proposal.comment && (
                <p className="order-assistant__comment">{session.proposal.comment}</p>
              )}
            </section>
          )}
        </div>
        {error && (
          <AppAlert title="Не удалось выполнить действие" tone="danger">
            {error}
          </AppAlert>
        )}
        {error && canRetryAnswer && (
          <AppButton
            type="button"
            variant="secondary"
            disabled={Boolean(busy) || preparingPhotos || editing}
            onClick={() => {
              if (failedAnswer) void answer(failedAnswer.action);
            }}
          >
            Повторить выбранный ответ
          </AppButton>
        )}
        {error && session && (
          <AppButton
            type="button"
            variant="ghost"
            disabled={Boolean(busy) || preparingPhotos || editing}
            onClick={() => void run("reload")}
          >
            Обновить состояние диалога
          </AppButton>
        )}
        {success && <AppAlert title={success} tone="success" />}
        {Boolean(session?.attachments?.length) && !applied && (
          <AppCheckbox
            label="Названия, количество и единицы сверены с фотографиями"
            checked={photosReviewed}
            onCheckedChange={setPhotosReviewed}
            disabled={Boolean(busy) || preparingPhotos || editing}
          />
        )}
        {context.mode === "CREATE" &&
          session?.ready &&
          user?.permissions?.includes("warehouse.negative_stock") && (
            <AppCheckbox
              label="Разрешить заказ при нехватке остатка"
              checked={allowStockShortage}
              onCheckedChange={setAllowStockShortage}
              disabled={Boolean(busy) || Boolean(applied)}
            />
          )}
        <div className="order-assistant__footer">
          <p>
            {session?.orderId
              ? "Заказ сохранён. Откройте его или продолжите правки в чате."
              : session?.mode === "CREATE"
                ? session.ready
                  ? session.attachments?.length && !photosReviewed
                    ? "Сверьте распознанные позиции с фото и отметьте проверку. Затем можно создать заказ."
                    : "Черновик готов. Нажмите «Создать заказ» или проверьте его в форме."
                  : "Заказ ещё не создан: остались уточнения. Продолжите в чате или откройте форму для оформления."
                : applied
                  ? "Состав передан в форму. Сохраните заказ в ней."
                  : "Проверьте состав. Изменения применятся после вашего подтверждения."}
          </p>
          <div className="order-assistant__actions">
            {session?.orderId && onOpenOrder && (
              <AppButton
                type="button"
                variant="secondary"
                disabled={Boolean(busy) || preparingPhotos || editing}
                onClick={() => session.orderId && onOpenOrder(session.orderId)}
              >
                <ArrowUpRight size={17} />
                Открыть заказ
              </AppButton>
            )}
            {session?.mode === "CREATE" && !session.orderId && onReviewDraft && (
              <AppButton
                type="button"
                variant="secondary"
                disabled={Boolean(busy) || preparingPhotos || editing}
                onClick={() => onReviewDraft(session.id)}
              >
                <ClipboardPen size={17} />
                Открыть форму заказа
              </AppButton>
            )}
            <AppButton
              type="button"
              variant="ghost"
              disabled={Boolean(busy) || preparingPhotos || editing}
              onClick={() => onOpenChange(false)}
            >
              Закрыть
            </AppButton>
            <AppButton
              type="button"
              disabled={
                !session?.ready ||
                Boolean(applied) ||
                Boolean(busy) ||
                Boolean(failedAnswer) ||
                (Boolean(session?.attachments?.length) && !photosReviewed) ||
                preparingPhotos ||
                editing ||
                photos.length > 0 ||
                Boolean(message.trim())
              }
              loading={busy === "apply"}
              onClick={() => void run("apply")}
            >
              <Check size={17} />
              {context.mode === "DRAFT"
                ? "Применить к форме"
                : session?.orderId
                  ? "Сохранить правки"
                  : "Создать заказ"}
            </AppButton>
          </div>
        </div>
      </div>
    </AppModal>
  );
}
