import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Keyboard, RotateCcw } from "lucide-react";
import { AppButton } from "@/shared/ui/AppButton";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import "./BarcodeScannerModal.css";

export type BarcodeScannerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (value: string) => void;
  onManualEntry: () => void;
};

type ScannerState = "idle" | "requesting" | "scanning" | "denied" | "unavailable" | "error";

type DetectedBarcode = {
  rawValue: string;
};

type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

type ZxingScannerControls = {
  stop: () => void;
};

const DETECTION_INTERVAL_MS = 140;
const DUPLICATE_COOLDOWN_MS = 1_500;

function getCameraErrorState(error: unknown): ScannerState {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "denied";
    }

    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "unavailable";
    }
  }

  return "error";
}

export function BarcodeScannerModal({
  open,
  onOpenChange,
  onDetected,
  onManualEntry,
}: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<ZxingScannerControls | null>(null);
  const sessionRef = useRef(0);
  const handledResultRef = useRef(false);
  const lastDetectionRef = useRef<{ value: string; at: number } | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const onDetectedRef = useRef(onDetected);
  const [scannerState, setScannerState] = useState<ScannerState>("idle");

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
    onDetectedRef.current = onDetected;
  }, [onDetected, onOpenChange]);

  const stopScanner = useCallback(() => {
    sessionRef.current += 1;
    handledResultRef.current = true;

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const finishDetection = useCallback(
    (rawValue: string) => {
      const value = rawValue.trim();
      if (!value || handledResultRef.current) {
        return;
      }

      const now = Date.now();
      const lastDetection = lastDetectionRef.current;
      if (
        lastDetection &&
        lastDetection.value === value &&
        now - lastDetection.at < DUPLICATE_COOLDOWN_MS
      ) {
        return;
      }

      handledResultRef.current = true;
      lastDetectionRef.current = { value, at: now };
      stopScanner();

      if (typeof navigator.vibrate === "function") {
        navigator.vibrate(100);
      }

      onOpenChangeRef.current(false);
      onDetectedRef.current(value);
    },
    [stopScanner],
  );

  const startNativeDetection = useCallback(
    (detector: BarcodeDetectorInstance, video: HTMLVideoElement, session: number) => {
      let lastScanAt = 0;

      const scanFrame = async (now: number) => {
        if (sessionRef.current !== session || handledResultRef.current) {
          return;
        }

        if (
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          now - lastScanAt >= DETECTION_INTERVAL_MS
        ) {
          lastScanAt = now;
          try {
            const barcodes = await detector.detect(video);
            if (barcodes[0]?.rawValue) {
              finishDetection(barcodes[0].rawValue);
              return;
            }
          } catch {
            // Отдельные кадры могут быть недоступны во время автофокуса камеры.
          }
        }

        if (sessionRef.current === session && !handledResultRef.current) {
          animationFrameRef.current = window.requestAnimationFrame(scanFrame);
        }
      };

      animationFrameRef.current = window.requestAnimationFrame(scanFrame);
    },
    [finishDetection],
  );

  const startZxingDetection = useCallback(
    async (stream: MediaStream, video: HTMLVideoElement, session: number) => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      if (sessionRef.current !== session) {
        return;
      }

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
      const reader = new BrowserMultiFormatReader(hints);
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result && sessionRef.current === session) {
          finishDetection(result.getText());
        }
      });

      if (sessionRef.current !== session || handledResultRef.current) {
        controls.stop();
        return;
      }

      zxingControlsRef.current = controls;
    },
    [finishDetection],
  );

  const startScanner = useCallback(async () => {
    stopScanner();
    handledResultRef.current = false;
    const session = sessionRef.current;
    setScannerState("requesting");

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerState("unavailable");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (sessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      if (sessionRef.current !== session) {
        return;
      }

      setScannerState("scanning");
      const BarcodeDetectorApi = (
        globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }
      ).BarcodeDetector;

      let supportsNativeCode128 = Boolean(BarcodeDetectorApi);
      if (BarcodeDetectorApi?.getSupportedFormats) {
        const formats = await BarcodeDetectorApi.getSupportedFormats();
        supportsNativeCode128 = formats.includes("code_128");
      }

      if (BarcodeDetectorApi && supportsNativeCode128) {
        startNativeDetection(new BarcodeDetectorApi({ formats: ["code_128"] }), video, session);
      } else {
        await startZxingDetection(stream, video, session);
      }
    } catch (error) {
      if (sessionRef.current !== session) {
        return;
      }

      stopScanner();
      setScannerState(getCameraErrorState(error));
    }
  }, [startNativeDetection, startZxingDetection, stopScanner]);

  useEffect(() => {
    if (open) {
      void startScanner();
    } else {
      stopScanner();
      setScannerState("idle");
    }

    return stopScanner;
  }, [open, startScanner, stopScanner]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      stopScanner();
    }
    onOpenChange(nextOpen);
  };

  const handleManualEntry = () => {
    stopScanner();
    onOpenChange(false);
    onManualEntry();
  };

  const errorContent = {
    denied: {
      title: "Нет доступа к камере",
      message: "Разрешите доступ к камере в настройках браузера и попробуйте снова.",
    },
    unavailable: {
      title: "Камера недоступна",
      message:
        "На устройстве не найдена доступная камера или браузер не поддерживает её использование.",
    },
    error: {
      title: "Не удалось запустить сканер",
      message: "Закройте другие приложения, использующие камеру, и попробуйте снова.",
    },
  } as const;

  const error =
    scannerState === "denied" || scannerState === "unavailable" || scannerState === "error"
      ? errorContent[scannerState]
      : null;

  return (
    <AppModal
      open={open}
      onOpenChange={handleOpenChange}
      title="Сканирование штрихкода"
      description="Наведите камеру на штрихкод товара Code 128."
      contentClassName="barcode-scanner-modal"
    >
      <div className="barcode-scanner" aria-live="polite">
        <div className="barcode-scanner__viewport">
          <video
            ref={videoRef}
            className="barcode-scanner__video"
            muted
            playsInline
            aria-label="Изображение с камеры для сканирования штрихкода"
          />
          <div className="barcode-scanner__shade" aria-hidden="true" />
          <div className="barcode-scanner__target" aria-hidden="true">
            <span />
          </div>
          {scannerState === "requesting" && (
            <div className="barcode-scanner__placeholder">
              <Camera size={30} aria-hidden="true" />
              <span>Запрашиваем доступ к камере…</span>
            </div>
          )}
        </div>

        {scannerState === "scanning" && (
          <p className="barcode-scanner__status">Поместите штрихкод внутрь рамки</p>
        )}

        {error && (
          <AppAlert title={error.title} tone="danger">
            {error.message}
          </AppAlert>
        )}

        <div className="barcode-scanner__actions">
          {error && (
            <AppButton type="button" variant="secondary" onClick={() => void startScanner()}>
              <RotateCcw size={18} aria-hidden="true" />
              Повторить
            </AppButton>
          )}
          <AppButton type="button" variant="neutral" onClick={handleManualEntry}>
            <Keyboard size={18} aria-hidden="true" />
            Ввести код вручную
          </AppButton>
        </div>
      </div>
    </AppModal>
  );
}
