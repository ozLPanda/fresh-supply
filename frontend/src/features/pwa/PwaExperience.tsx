import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Share } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { AppButton } from "@/shared/ui/AppButton";
import { AppModal } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import "./PwaExperience.css";

const INSTALL_PROMPT_ENABLED = false;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isMobileDevice() {
  const userAgent = navigator.userAgent;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isIosSafari() {
  const userAgent = navigator.userAgent;
  const iosDevice =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  return iosDevice && safari;
}

export function PwaExperience() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [mobileDevice] = useState(() => isMobileDevice());
  const [installDismissed, setInstallDismissed] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const iosInstallAvailable = useMemo(() => !installed && isIosSafari(), [installed]);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("Не удалось зарегистрировать service worker", error);
    },
  });

  useEffect(() => {
    function handleInstallPrompt(event: Event) {
      event.preventDefault();
      if (!mobileDevice) return;
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallDismissed(false);
    }

    function handleInstalled() {
      setInstallPrompt(null);
      setInstalled(true);
      appToast.success("Приложение установлено");
    }

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [mobileDevice]);

  useEffect(() => {
    if (!offlineReady) return;
    appToast.success("Приложение готово к работе без сети");
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    async function checkForUpdate() {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      } catch (error) {
        console.warn("Не удалось проверить обновление приложения", error);
      }
    }

    function checkWhenVisible() {
      if (document.visibilityState === "visible") void checkForUpdate();
    }

    void checkForUpdate();
    const intervalId = window.setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) {
      setInstallHelpOpen(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      appToast.success("Установка приложения началась");
    }
  }

  async function refreshApplication() {
    if (updating) return;

    setUpdating(true);

    try {
      await updateServiceWorker(true);
    } catch (error) {
      console.error("Не удалось обновить приложение", error);
      appToast.error("Не удалось обновить приложение");
      setUpdating(false);
    }
  }

  const showInstall = INSTALL_PROMPT_ENABLED && mobileDevice && !installed && !installDismissed;
  const showRefreshPrompt = needRefresh;
  const manualInstallDescription = window.isSecureContext
    ? "Браузер пока не предложил автоматическую установку."
    : "Установка веб-приложений доступна только через HTTPS или на localhost.";

  return (
    <>
      {(showInstall || showRefreshPrompt) && (
        <aside className="pwa-prompt" aria-live="polite">
          <div className="pwa-prompt__copy">
            <strong>{showRefreshPrompt ? "Доступна новая версия" : "Установить приложение"}</strong>
            <span>
              {showRefreshPrompt
                ? "Обновите сайт, когда вам удобно."
                : installPrompt || iosInstallAvailable
                  ? "Быстрый запуск с экрана устройства."
                  : "Добавьте сайт на главный экран через браузер."}
            </span>
          </div>
          <div className="pwa-prompt__actions">
            {showRefreshPrompt ? (
              <AppButton
                type="button"
                loading={updating}
                loadingText="Обновляем…"
                onClick={() => void refreshApplication()}
              >
                <RefreshCw size={18} aria-hidden="true" />
                Обновить
              </AppButton>
            ) : (
              <AppButton type="button" onClick={() => void installApp()}>
                <Download size={18} aria-hidden="true" />
                Установить
              </AppButton>
            )}
            <AppButton
              type="button"
              variant="ghost"
              disabled={updating}
              onClick={() => {
                if (needRefresh) setNeedRefresh(false);
                setInstallDismissed(true);
              }}
            >
              Позже
            </AppButton>
          </div>
        </aside>
      )}

      <AppModal
        title={iosInstallAvailable ? "Установка на iPhone или iPad" : "Установка приложения"}
        description={
          iosInstallAvailable
            ? "Safari устанавливает веб-приложения через меню общего доступа."
            : manualInstallDescription
        }
        open={installHelpOpen}
        onOpenChange={setInstallHelpOpen}
      >
        <div className="pwa-ios-help">
          {iosInstallAvailable ? (
            <>
              <Share size={28} aria-hidden="true" />
              <ol>
                <li>Нажмите «Поделиться» в панели Safari.</li>
                <li>Выберите «На экран Домой».</li>
                <li>Подтвердите действие кнопкой «Добавить».</li>
              </ol>
            </>
          ) : (
            <>
              <Download size={28} aria-hidden="true" />
              <div className="pwa-install-help__content">
                {window.isSecureContext ? (
                  <p>
                    Откройте меню браузера и выберите «Установить приложение» или «Добавить на
                    главный экран». Если пункта ещё нет, обновите страницу и попробуйте снова.
                  </p>
                ) : (
                  <p>
                    Откройте сайт по защищённому адресу HTTPS. На обычном HTTP-адресе в локальной
                    сети браузер не зарегистрирует приложение.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </AppModal>
    </>
  );
}
