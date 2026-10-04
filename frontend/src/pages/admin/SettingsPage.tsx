import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import {
  fetchProjectSettings,
  updateProjectSettings,
  type ProjectSettings,
} from "@/shared/api/settings";
import { AppSwitch } from "@/shared/ui/AppControls";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppTextarea } from "@/shared/ui/AppField";
import { api } from "@/shared/api/http";
import { AppButton } from "@/shared/ui/AppButton";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import "./SettingsPage.css";

const queryKey = ["project-settings"];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useCommerce();
  const canManageProjectSettings = user?.permissions.includes("pages.settings.view") ?? false;
  const [excludedNameTermsDraft, setExcludedNameTermsDraft] = useState("");
  const [invoiceTemplate, setInvoiceTemplate] = useState("");
  const orderSettings = useQuery({
    queryKey: ["my-order-settings"],
    queryFn: () => api<{ invoiceTemplate: string }>("/api/auth/order-settings"),
  });
  const saveOrderSettings = useMutation({
    mutationFn: () =>
      api<{ invoiceTemplate: string }>("/api/auth/order-settings", {
        method: "PUT",
        body: JSON.stringify({ invoiceTemplate }),
      }),
    onSuccess: (data) => {
      setInvoiceTemplate(data.invoiceTemplate);
      queryClient.setQueryData(["my-order-settings"], data);
    },
  });
  const settings = useQuery({
    queryKey,
    queryFn: fetchProjectSettings,
    enabled: canManageProjectSettings,
  });
  const mutation = useMutation({
    mutationFn: updateProjectSettings,
    onSuccess: (data) => {
      queryClient.setQueryData<ProjectSettings>(queryKey, data);
    },
  });
  const searchAiEnabled = settings.data?.searchAiEnabled ?? false;
  const embeddingsConfigured = settings.data?.embeddingsConfigured ?? false;
  const wholesaleMinQuantity = settings.data?.wholesaleMinQuantity ?? 10;
  const priceImportExcludedNameTerms = settings.data?.priceImportExcludedNameTerms ?? [];
  const saving = mutation.isPending;

  useEffect(() => {
    if (settings.data) {
      setExcludedNameTermsDraft(settings.data.priceImportExcludedNameTerms.join("\n"));
    }
  }, [settings.data]);
  useEffect(() => {
    if (orderSettings.data) setInvoiceTemplate(orderSettings.data.invoiceTemplate);
  }, [orderSettings.data]);

  function changeSearchAiEnabled(nextValue: boolean) {
    mutation.mutate({
      searchAiEnabled: nextValue,
      wholesaleMinQuantity,
      priceImportExcludedNameTerms,
    });
  }

  function excludedNameTermsFromDraft() {
    return [
      ...new Set(
        excludedNameTermsDraft
          .split(/[\n,]+/)
          .map((term) => term.trim())
          .filter(Boolean),
      ),
    ];
  }

  function saveExcludedNameTerms() {
    const nextTerms = excludedNameTermsFromDraft();
    setExcludedNameTermsDraft(nextTerms.join("\n"));
    if (nextTerms.join("\n") !== priceImportExcludedNameTerms.join("\n")) {
      mutation.mutate({
        searchAiEnabled,
        wholesaleMinQuantity,
        priceImportExcludedNameTerms: nextTerms,
      });
    }
  }

  return (
    <AdminPage
      title="Настройки"
      eyebrow="Администрирование"
      actions={
        canManageProjectSettings ? (
          <AppBadge tone={searchAiEnabled ? "green" : "slate"}>
            {searchAiEnabled ? "ИИ включен" : "ИИ выключен"}
          </AppBadge>
        ) : undefined
      }
    >
      <DataPanel title="Мои настройки заказов">
        <div className="admin-panel-body">
          <AppTextarea
            label="Текст в начале накладной"
            hint="При принятии оплаты после этого текста автоматически добавится способ оплаты и суммы."
            value={invoiceTemplate}
            maxLength={2_000}
            rows={4}
            placeholder="Например: Товар отпустил …"
            disabled={orderSettings.isLoading || saveOrderSettings.isPending}
            onChange={(event) => setInvoiceTemplate(event.target.value)}
          />
          <AppButton
            type="button"
            disabled={orderSettings.isLoading}
            loading={saveOrderSettings.isPending}
            onClick={() => saveOrderSettings.mutate()}
          >
            Сохранить шаблон
          </AppButton>
          {(orderSettings.isError || saveOrderSettings.isError) && (
            <AppAlert title="Не удалось сохранить шаблон" tone="danger">
              Проверьте соединение с API и повторите попытку.
            </AppAlert>
          )}
        </div>
      </DataPanel>

      {canManageProjectSettings &&
        (settings.isLoading ? (
          <DataPanel title="Настройки">
            <div className="admin-panel-body">
              <AppSkeleton />
            </div>
          </DataPanel>
        ) : settings.isError ? (
          <DataPanel title="Настройки">
            <div className="admin-panel-body">
              <AppAlert
                title="Не удалось получить настройки"
                tone="danger"
                onRetry={() => settings.refetch()}
              >
                Проверьте соединение с API и повторите попытку.
              </AppAlert>
            </div>
          </DataPanel>
        ) : (
          <>
            <DataPanel
              title="Поиск"
              actions={
                <AppBadge tone={searchAiEnabled ? "green" : "slate"}>
                  {searchAiEnabled ? "Активно" : "Отключено"}
                </AppBadge>
              }
            >
              <div className="admin-panel-body">
                <AppSwitch
                  label="Использовать ИИ при поиске"
                  description="Если модель недоступна, каталог продолжит работать через обычный поиск."
                  checked={searchAiEnabled}
                  disabled={saving}
                  onCheckedChange={changeSearchAiEnabled}
                />
                {!embeddingsConfigured && (
                  <AppAlert title="ИИ-поиск отключен в конфигурации" tone="warning">
                    Переключатель сохранится, но backend будет использовать обычный поиск до
                    включения embedding-service.
                  </AppAlert>
                )}
              </div>
            </DataPanel>

            <DataPanel title="Уровни цен" actions={<AppBadge tone="blue">По ролям</AppBadge>}>
              <div className="admin-panel-body">
                <p className="admin-panel-text">
                  Розница доступна всем. Опт, крупный опт и СКО выдаются правами роли и
                  рассчитываются по всей корзине.
                </p>
                <p className="admin-panel-text">
                  Крупный опт доступен от 250&nbsp;000 ₸, СКО — от 350&nbsp;000 ₸. Для перехода на
                  уровень цена этого уровня должна быть задана у каждой позиции.
                </p>
              </div>
            </DataPanel>

            <DataPanel
              title="Импорт цен"
              actions={<AppBadge tone="slate">Системные: «Не выбирать», «Корзина»</AppBadge>}
            >
              <div className="admin-panel-body">
                <AppTextarea
                  label="Исключения по названию товара"
                  hint="Добавляйте по одному слову или фразе на строку. Регистр не учитывается: товары с совпадением в названии не попадут в импорт и не будут созданы на сайте."
                  value={excludedNameTermsDraft}
                  rows={6}
                  disabled={saving}
                  placeholder={"Например:\nвитринный образец\nуточняйте цену"}
                  onChange={(event) => setExcludedNameTermsDraft(event.target.value)}
                />
                <AppButton type="button" disabled={saving} onClick={saveExcludedNameTerms}>
                  Сохранить исключения
                </AppButton>
              </div>
            </DataPanel>

            <DataPanel title="Аналитика товаров">
              <div className="admin-panel-body settings-page__analysis">
                <p className="admin-panel-text">
                  Найдите товары с пометкой «нет в наличии» в названии и переведите их в доступный
                  для клиентов статус «Под заказ».
                </p>
                <AppButton asChild variant="secondary">
                  <Link to="/admin/settings/product-availability-analysis">
                    <ScanSearch size={17} />
                    Открыть анализ
                  </Link>
                </AppButton>
              </div>
            </DataPanel>

            {mutation.isError && (
              <AppAlert title="Не удалось сохранить настройку" tone="danger">
                Изменение не применено. Повторите попытку.
              </AppAlert>
            )}
          </>
        ))}
    </AdminPage>
  );
}
