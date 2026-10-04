import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  KeyboardEvent,
  useId,
  useMemo,
  useRef,
} from "react";
import { Check, ImagePlus, Star, Trash2, UploadCloud } from "lucide-react";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import "./AppImageUpload.css";

export type AppImageUploadItem = {
  id: string;
  src: string;
  name: string;
  main?: boolean;
  pending?: boolean;
};

export function AppImageUpload({
  items,
  maxFiles = 10,
  disabled,
  onFilesSelected,
  onRemove,
  onSetMain,
}: {
  items: AppImageUploadItem[];
  maxFiles?: number;
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
  onRemove: (item: AppImageUploadItem) => void;
  onSetMain?: (item: AppImageUploadItem) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const available = Math.max(0, maxFiles - items.length);
  const visibleItems = useMemo(
    () =>
      [...items].sort((left, right) => Number(Boolean(right.main)) - Number(Boolean(left.main))),
    [items],
  );

  function selectFiles(fileList: FileList | File[] | null) {
    if (!fileList || available === 0 || disabled) return;
    onFilesSelected(Array.from(fileList).slice(0, available));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    selectFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    selectFiles(event.dataTransfer.files);
  }

  function handlePaste(event: ClipboardEvent<HTMLLabelElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return;

    event.preventDefault();
    selectFiles(files);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLabelElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    inputRef.current?.click();
  }

  return (
    <section className="app-image-upload">
      <header className="app-image-upload__header">
        <div>
          <strong>Изображения</strong>
          <span>Первое или отмеченное фото используется как главное.</span>
        </div>
        <AppBadge tone={items.length >= maxFiles ? "orange" : "slate"}>
          {items.length} из {maxFiles}
        </AppBadge>
      </header>

      {visibleItems.length > 0 && (
        <div className="app-image-upload__gallery">
          {visibleItems.map((item, index) => (
            <article
              className={`app-image-upload__item ${index === 0 ? "is-featured" : ""}`}
              key={item.id}
            >
              <img src={item.src} alt={item.name} />
              <div className="app-image-upload__item-top">
                {item.main ? (
                  <AppBadge tone="orange">
                    <Star size={12} />
                    Главное
                  </AppBadge>
                ) : item.pending ? (
                  <AppBadge tone="blue">После сохранения</AppBadge>
                ) : null}
              </div>
              <div className="app-image-upload__item-actions">
                {!item.main && !item.pending && onSetMain && (
                  <AppButton
                    type="button"
                    variant="secondary"
                    aria-label={`Сделать главным: ${item.name}`}
                    title="Сделать главным"
                    disabled={disabled}
                    onClick={() => onSetMain(item)}
                  >
                    <Check size={16} />
                  </AppButton>
                )}
                <AppButton
                  type="button"
                  variant="danger"
                  aria-label={`Удалить изображение: ${item.name}`}
                  title="Удалить"
                  disabled={disabled}
                  onClick={() => onRemove(item)}
                >
                  <Trash2 size={16} />
                </AppButton>
              </div>
            </article>
          ))}
        </div>
      )}

      <label
        className={`app-image-upload__dropzone ${available === 0 || disabled ? "is-disabled" : ""}`}
        htmlFor={inputId}
        tabIndex={available > 0 && !disabled ? 0 : -1}
        aria-describedby={`${inputId}-hint`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
      >
        {visibleItems.length ? <ImagePlus size={25} /> : <UploadCloud size={30} />}
        <b>{available > 0 ? "Добавить фотографии" : "Достигнут лимит фотографий"}</b>
        <span id={`${inputId}-hint`}>
          {available > 0
            ? `Перетащите JPEG, PNG или WEBP, выберите файлы или вставьте изображение через Ctrl/Cmd+V · доступно ${available}`
            : `У товара может быть не более ${maxFiles} фотографий`}
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled || available === 0}
          onChange={handleChange}
        />
      </label>
    </section>
  );
}
