import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bot, Minus, Plus, Send, Trash2 } from "lucide-react";
import {
  analyzeInventoryPhotos,
  clarifyInventoryPhotos,
  type InventoryAiResult,
  type InventoryAiRow,
} from "@/shared/api/warehouseInventoryAi";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppFileUpload } from "@/shared/ui/AppControls";
import { AppTextarea } from "@/shared/ui/AppField";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppTable } from "@/shared/ui/AppTable";
import "./WarehouseInventoryAiAssistant.css";

type ChatMessage = { role: "assistant" | "user"; text: string };
type PhotoPreview = { src: string; name: string };

function InventoryPhotoThumbnail({
  file,
  index,
  onOpen,
}: {
  file: File;
  index: number;
  onOpen: (preview: PhotoPreview) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<{ file: File; src: string } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl({ file, src: url });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const src = previewUrl?.file === file ? previewUrl.src : "";

  return (
    <button
      type="button"
      className="warehouse-inventory-ai__thumbnail"
      aria-label={`Просмотреть фото ${index + 1}: ${file.name}`}
      disabled={!src}
      onClick={() => onOpen({ src, name: file.name })}
    >
      {src && <img src={src} alt="" />}
    </button>
  );
}

function InventoryPhotoPreview({ src, name }: PhotoPreview) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => {
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const fitScale =
    naturalSize.width && naturalSize.height && viewportSize.width && viewportSize.height
      ? Math.min(
          1,
          viewportSize.width / naturalSize.width,
          viewportSize.height / naturalSize.height,
        )
      : 1;
  const originalZoom = 1 / fitScale;
  const maxZoom = Math.max(8, originalZoom);
  const renderedWidth = naturalSize.width * fitScale * zoom;
  const renderedHeight = naturalSize.height * fitScale * zoom;

  return (
    <>
      <div className="warehouse-inventory-ai__photo-toolbar">
        <span>{name}</span>
        <div className="warehouse-inventory-ai__zoom-controls" aria-label="Масштаб изображения">
          <AppButton
            type="button"
            variant="ghost"
            aria-label="Уменьшить изображение"
            disabled={zoom <= 1}
            onClick={() => setZoom((current) => Math.max(1, current / 1.5))}
          >
            <Minus size={18} />
          </AppButton>
          <span aria-live="polite">{Math.round(fitScale * zoom * 100)}%</span>
          <AppButton
            type="button"
            variant="ghost"
            aria-label="Увеличить изображение"
            disabled={zoom >= maxZoom}
            onClick={() => setZoom((current) => Math.min(maxZoom, current * 1.5))}
          >
            <Plus size={18} />
          </AppButton>
          <AppButton type="button" variant="ghost" disabled={zoom === 1} onClick={() => setZoom(1)}>
            Вписать
          </AppButton>
          <AppButton
            type="button"
            variant="ghost"
            disabled={zoom === originalZoom}
            onClick={() => setZoom(originalZoom)}
          >
            Оригинал
          </AppButton>
        </div>
      </div>
      <div className="warehouse-inventory-ai__photo-viewport" ref={viewportRef}>
        <div
          className="warehouse-inventory-ai__photo-canvas"
          style={{
            width: `max(100%, ${renderedWidth}px)`,
            height: `max(100%, ${renderedHeight}px)`,
          }}
        >
          <img
            src={src}
            alt={name}
            style={naturalSize.width ? { width: renderedWidth, height: renderedHeight } : undefined}
            onLoad={(event) =>
              setNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        </div>
      </div>
    </>
  );
}

function isReady(row: InventoryAiRow) {
  return (
    row.productId != null &&
    row.suggestedProductId == null &&
    row.quantity != null &&
    Number.isFinite(row.quantity) &&
    row.quantity >= 0 &&
    !row.question
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось обработать документ";
}

export function WarehouseInventoryAiAssistant({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (rows: InventoryAiRow[]) => boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<InventoryAiResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasApplied, setHasApplied] = useState(false);
  const [hasImported, setHasImported] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<PhotoPreview | null>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const readyRows = result?.rows.filter(isReady) ?? [];
  const pendingRows = result?.rows.filter((row) => !isReady(row)) ?? [];
  const suggestedRows = pendingRows.filter((row) => row.suggestedProductId != null);

  function prepareSuggestionConfirmation(row: InventoryAiRow) {
    const location = `лист ${row.pageNumber}, строка ${row.sourceNumber ?? "?"}`;
    const article = row.suggestedSku ? `, артикул ${row.suggestedSku}` : "";
    setAnswer((current) =>
      [current.trim(), `Подтверждаю предложенный товар для ${location}${article}.`]
        .filter(Boolean)
        .join("\n"),
    );
    answerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) setPhotoPreview(null);
  }, [open]);

  function clearAnalysis() {
    setResult(null);
    setMessages([]);
    setHasApplied(false);
  }

  function moveFile(index: number, delta: number) {
    clearAnalysis();
    setFiles((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addFiles(selected: File[]) {
    const next = [...files, ...selected];
    if (next.length > 8) {
      setError("Можно загрузить не более 8 фотографий.");
      return;
    }
    if (next.some((file) => file.size > 10 * 1024 * 1024)) {
      setError("Размер каждой фотографии должен быть не более 10 МБ.");
      return;
    }
    if (next.reduce((total, file) => total + file.size, 0) > 40 * 1024 * 1024) {
      setError("Общий размер фотографий не должен превышать 40 МБ.");
      return;
    }
    setError("");
    clearAnalysis();
    setFiles(next);
  }

  async function analyze() {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await analyzeInventoryPhotos(files);
      setResult(next);
      setMessages(
        next.assistantMessage ? [{ role: "assistant", text: next.assistantMessage }] : [],
      );
      setHasApplied(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = answer.trim();
    if (!result || !message || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await clarifyInventoryPhotos(result.rows, message);
      setResult(next);
      if (hasApplied && onApply(next.rows.filter(isReady))) setHasImported(next.rows.some(isReady));
      setMessages((current) => [
        ...current,
        { role: "user", text: message },
        ...(next.assistantMessage
          ? [{ role: "assistant" as const, text: next.assistantMessage }]
          : []),
      ]);
      setAnswer("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppModal
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            setPhotoPreview(null);
            onClose();
          }
        }}
        title="Помощь ИИ в инвентаризации"
        description="Загрузите фотографии в порядке страниц. Проверьте распознанные количества и предложения товаров перед переносом строк в документ."
        contentClassName={`warehouse-inventory-ai${result ? " warehouse-inventory-ai--has-result" : ""}`}
      >
        <div className="warehouse-inventory-ai__content">
          <section className="warehouse-inventory-ai__upload" aria-label="Фотографии ведомости">
            <AppFileUpload
              label="Добавить фотографии"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy}
              onChange={addFiles}
            />
            {files.length > 0 && (
              <ol className="warehouse-inventory-ai__files">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <div className="warehouse-inventory-ai__file-info">
                      <InventoryPhotoThumbnail file={file} index={index} onOpen={setPhotoPreview} />
                      <span>
                        {index + 1}. {file.name}
                      </span>
                    </div>
                    <div>
                      <AppButton
                        type="button"
                        variant="ghost"
                        aria-label={`Поднять фото ${index + 1}`}
                        disabled={busy || index === 0}
                        onClick={() => moveFile(index, -1)}
                      >
                        <ArrowUp size={16} />
                      </AppButton>
                      <AppButton
                        type="button"
                        variant="ghost"
                        aria-label={`Опустить фото ${index + 1}`}
                        disabled={busy || index === files.length - 1}
                        onClick={() => moveFile(index, 1)}
                      >
                        <ArrowDown size={16} />
                      </AppButton>
                      <AppButton
                        type="button"
                        variant="ghost"
                        aria-label={`Удалить фото ${index + 1}`}
                        disabled={busy}
                        onClick={() => {
                          clearAnalysis();
                          setFiles((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          );
                        }}
                      >
                        <Trash2 size={16} />
                      </AppButton>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <AppButton
              type="button"
              loading={busy}
              loadingText="Читаем фотографии"
              disabled={!files.length || busy}
              onClick={analyze}
            >
              <Bot size={17} /> Собрать таблицу
            </AppButton>
          </section>

          {error && (
            <AppAlert title="Ошибка обработки" tone="danger">
              {error}
            </AppAlert>
          )}

          {result && (
            <>
              <section
                className="warehouse-inventory-ai__preview"
                aria-label="Предварительная таблица"
              >
                <div className="warehouse-inventory-ai__summary">
                  <strong>Строки в порядке ведомости</strong>
                  <span>
                    Готово к переносу: {readyRows.length} · Предложены товары:{" "}
                    {suggestedRows.length} · Требуют ответа: {pendingRows.length}
                  </span>
                </div>
                <AppTable
                  headers={["Лист / №", "Название на бумаге", "Номенклатура", "Факт", "Состояние"]}
                  rows={result.rows.map((row) => [
                    `${row.pageNumber} / ${row.sourceNumber ?? "?"}`,
                    row.sourceName || "Не прочитано",
                    row.productName ? (
                      <span>
                        {row.productName}
                        {row.sku ? ` · арт. ${row.sku}` : ""}
                      </span>
                    ) : row.suggestedProductId != null ? (
                      <span className="warehouse-inventory-ai__suggestion">
                        <span>
                          {row.suggestedProductName || "Товар из каталога"}
                          {row.suggestedSku ? ` · арт. ${row.suggestedSku}` : ""}
                        </span>
                        <small>Предложение — ожидает подтверждения</small>
                      </span>
                    ) : (
                      "—"
                    ),
                    row.quantity ?? "—",
                    isReady(row) ? (
                      <AppBadge tone="green">Готово</AppBadge>
                    ) : row.suggestedProductId != null ? (
                      <AppBadge tone="blue">Предложен</AppBadge>
                    ) : (
                      <AppBadge tone="orange">Уточнить</AppBadge>
                    ),
                  ])}
                  size="compact"
                />
              </section>

              {pendingRows.length > 0 && (
                <section
                  className="warehouse-inventory-ai__questions"
                  aria-label="Вопросы по строкам"
                >
                  <strong>Нужно уточнить</strong>
                  <ul>
                    {pendingRows.map((row, index) => (
                      <li key={`${row.pageNumber}-${row.sourceNumber}-${index}`}>
                        <b>
                          Лист {row.pageNumber}, строка {row.sourceNumber ?? "?"}:
                        </b>{" "}
                        {row.question || "Уточните товар и количество."}
                        {row.suggestedProductId != null && (
                          <div className="warehouse-inventory-ai__question-suggestion">
                            <span>
                              Предлагаемый товар:{" "}
                              <b>{row.suggestedProductName || "Товар из каталога"}</b>
                              {row.suggestedSku && `, арт. ${row.suggestedSku}`}. Решение за вами.
                            </span>
                            <AppButton
                              type="button"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => prepareSuggestionConfirmation(row)}
                            >
                              Подготовить подтверждение в чате
                            </AppButton>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="warehouse-inventory-ai__chat" aria-label="Чат с помощником">
                <strong>Чат с помощником</strong>
                {suggestedRows.length > 0 && (
                  <p className="warehouse-inventory-ai__chat-hint">
                    Проверьте предложенные товары. В чате можно написать «Подтверждаю предложенные
                    товары для строк 1, 2» или «Подтверждаю все предложенные товары». Для замены
                    укажите строку и нужный артикул. До вашего подтверждения предложения не попадут
                    в документ.
                  </p>
                )}
                <div className="warehouse-inventory-ai__messages" role="log" aria-live="polite">
                  {messages.map((message, index) => (
                    <p
                      key={index}
                      className={`warehouse-inventory-ai__message warehouse-inventory-ai__message--${message.role}`}
                    >
                      <b>{message.role === "user" ? "Вы" : "ИИ"}</b> {message.text}
                    </p>
                  ))}
                </div>
                <form className="warehouse-inventory-ai__answer" onSubmit={ask}>
                  <AppTextarea
                    ref={answerRef}
                    label="Ответ на вопросы по строкам"
                    rows={2}
                    value={answer}
                    disabled={busy}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="Например: строка 12 — 7 шт.; подтверждаю предложенный товар для строки 12"
                  />
                  <AppButton
                    type="submit"
                    loading={busy}
                    loadingText="Уточняем"
                    disabled={!answer.trim() || busy}
                  >
                    <Send size={16} /> Отправить
                  </AppButton>
                </form>
              </section>
            </>
          )}
        </div>
        {result && (
          <div className="warehouse-inventory-ai__actions">
            <span>
              В документ попадут только строки с подтверждённым товаром и понятным количеством.
              Предложения ждут вашего ответа в чате.
            </span>
            <AppButton
              type="button"
              disabled={busy || (!readyRows.length && !hasImported)}
              onClick={() => {
                if (onApply(readyRows)) {
                  setHasApplied(true);
                  setHasImported(readyRows.length > 0);
                }
              }}
            >
              {!readyRows.length && hasImported
                ? "Убрать перенесённые строки"
                : hasApplied || hasImported
                  ? "Обновить строки документа"
                  : "Перенести понятные строки"}
            </AppButton>
          </div>
        )}
      </AppModal>
      <AppModal
        open={Boolean(photoPreview)}
        onOpenChange={(value) => {
          if (!value) setPhotoPreview(null);
        }}
        title="Просмотр фотографии"
        contentClassName="warehouse-inventory-ai__photo-modal"
      >
        {photoPreview && <InventoryPhotoPreview key={photoPreview.src} {...photoPreview} />}
      </AppModal>
    </>
  );
}
