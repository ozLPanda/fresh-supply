import { useEffect, useRef, useState } from "react";
import { RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { AppButton } from "@/shared/ui/AppButton";
import { AppModal } from "@/shared/ui/AppFeedback";
import type { OrderAssistantPhoto } from "@/shared/api/orderAssistant";
import "./OrderAssistantPhotos.css";

export const MAX_ASSISTANT_PHOTOS = 8;
export type PendingOrderPhoto = { id: string; name: string; dataUrl: string };

/** Decode before upload; preserve enough pixels for dense printed order forms. */
export async function prepareOrderPhoto(file: File): Promise<PendingOrderPhoto> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(`«${file.name}»: выберите JPEG, PNG или WebP.`);
  if (file.size > 20 * 1024 * 1024) throw new Error(`«${file.name}»: исходный файл больше 20 МБ.`);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const ratio = Math.min(1, 3200 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Браузер не смог подготовить фотографию.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    if (dataUrl.length * 0.75 > 5 * 1024 * 1024)
      throw new Error(
        `«${file.name}»: после обработки файл больше 5 МБ. Загрузите меньшую фотографию.`,
      );
    return { id: crypto.randomUUID(), name: file.name, dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function OrderAssistantPhotos({
  photos,
  pending = false,
  disabled,
  onRemove,
}: {
  photos: OrderAssistantPhoto[];
  pending?: boolean;
  disabled?: boolean;
  onRemove?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<OrderAssistantPhoto | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });
  const [viewport, setViewport] = useState({ width: 600, height: 500 });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selected) return;
    const update = () =>
      setViewport({
        width: Math.max(1, canvas.clientWidth - 32),
        height: window.innerHeight * 0.55,
      });
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    update();
    return () => observer.disconnect();
  }, [selected]);
  const sideways = rotation % 180 !== 0;
  const fittedScale = Math.min(
    viewport.width / (sideways ? naturalSize.height : naturalSize.width),
    viewport.height / (sideways ? naturalSize.width : naturalSize.height),
  );
  const imageWidth = naturalSize.width * fittedScale * zoom;
  const imageHeight = naturalSize.height * fittedScale * zoom;
  if (!photos.length) return null;
  return (
    <section
      className="order-assistant-photos"
      aria-label={pending ? "Фотографии к отправке" : "Фотографии заявки"}
    >
      <strong>{pending ? "Готовы к отправке" : "Фотографии заявки"}</strong>
      <div className="order-assistant-photos__grid">
        {photos.map((photo) => (
          <article className="order-assistant-photos__tile" key={photo.id}>
            <button
              type="button"
              className="order-assistant-photos__open"
              aria-label={`Открыть фото ${photo.number}: ${photo.name}`}
              onClick={() => {
                setSelected(photo);
                setZoom(1);
                setRotation(0);
              }}
            >
              <img src={photo.dataUrl} alt={`Фото ${photo.number}`} />
              <span>Фото {photo.number}</span>
            </button>
            {onRemove && (
              <AppButton
                type="button"
                variant="ghost"
                disabled={disabled}
                aria-label={`Убрать фото ${photo.number}`}
                onClick={() => onRemove(photo.id)}
              >
                <X size={15} />
              </AppButton>
            )}
          </article>
        ))}
      </div>
      <AppModal
        open={Boolean(selected)}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
        title={`Фото ${selected?.number ?? ""}`}
        description={selected?.name}
        contentClassName="order-assistant-photo-preview"
      >
        <div className="order-assistant-photo-preview__tools">
          <AppButton
            type="button"
            variant="secondary"
            disabled={zoom <= 1}
            aria-label="Уменьшить"
            onClick={() => setZoom((v) => Math.max(1, v - 0.5))}
          >
            <ZoomOut size={18} />
          </AppButton>
          <span>{Math.round(zoom * 100)}%</span>
          <AppButton
            type="button"
            variant="secondary"
            disabled={zoom >= 3}
            aria-label="Увеличить"
            onClick={() => setZoom((v) => Math.min(3, v + 0.5))}
          >
            <ZoomIn size={18} />
          </AppButton>
          <AppButton
            type="button"
            variant="secondary"
            aria-label="Повернуть для просмотра"
            onClick={() => {
              setRotation((v) => (v + 90) % 360);
              setZoom(1);
              canvasRef.current?.scrollTo(0, 0);
            }}
          >
            <RotateCw size={18} />
          </AppButton>
        </div>
        <div className="order-assistant-photo-preview__canvas" ref={canvasRef}>
          {selected && (
            <div
              style={{
                width: Math.max(viewport.width + 32, (sideways ? imageHeight : imageWidth) + 32),
                height: (sideways ? imageWidth : imageHeight) + 32,
              }}
            >
              <img
                src={selected.dataUrl}
                alt={`Фото заявки ${selected.number}`}
                onLoad={(event) =>
                  setNaturalSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                style={{
                  width: imageWidth,
                  height: imageHeight,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                }}
              />
            </div>
          )}
        </div>
      </AppModal>
    </section>
  );
}
