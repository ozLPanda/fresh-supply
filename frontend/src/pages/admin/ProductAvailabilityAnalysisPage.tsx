import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, RefreshCw, ScanSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import {
  applyProductAvailabilityRepair,
  previewProductAvailabilityRepair,
  type ProductAvailabilityRepairPreview,
} from "@/shared/api/productAvailabilityRepair";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppTextarea } from "@/shared/ui/AppField";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import "./ProductAvailabilityAnalysisPage.css";

const DEFAULT_KEYWORDS = ["нет в наличии"];

function parseKeywords(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    ),
  ];
}

export function ProductAvailabilityAnalysisPage() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [keywordsDraft, setKeywordsDraft] = useState(DEFAULT_KEYWORDS.join("\n"));
  const [analyzedKeywords, setAnalyzedKeywords] = useState(DEFAULT_KEYWORDS);
  const draftKeywords = useMemo(() => parseKeywords(keywordsDraft), [keywordsDraft]);
  const preview = useQuery({
    queryKey: ["product-availability-repair-preview", analyzedKeywords],
    queryFn: () => previewProductAvailabilityRepair(analyzedKeywords),
  });
  const candidates = preview.data ?? [];
  const applyRepair = useMutation({
    mutationFn: (productIds: number[]) =>
      applyProductAvailabilityRepair(productIds, analyzedKeywords),
    onSuccess: (result) => {
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["product-availability-repair-preview"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      appToast.success(
        result.updatedCount === 1
          ? "Товар переведён в статус «Под заказ»"
          : `Товары переведены в статус «Под заказ»: ${result.updatedCount}`,
      );
      if (result.skippedCount > 0) {
        appToast.info(`Пропущено позиций: ${result.skippedCount}`);
      }
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось применить изменения"),
  });

  const columns = useMemo<AppDataTableColumn<ProductAvailabilityRepairPreview>[]>(
    () => [
      {
        id: "product",
        header: "Товар",
        value: (product) => `${product.sku} ${product.currentNameRu}`,
        cell: (product) => (
          <div className="product-availability-analysis__product">
            <strong>{product.currentNameRu}</strong>
            <span>Артикул: {product.sku}</span>
          </div>
        ),
      },
      {
        id: "keywords",
        header: "Найдено по",
        value: (product) => product.matchedKeywords.join(" "),
        cell: (product) => (
          <div className="product-availability-analysis__keywords">
            {product.matchedKeywords.map((keyword) => (
              <AppBadge key={keyword} tone="slate">
                {keyword}
              </AppBadge>
            ))}
          </div>
        ),
      },
      {
        id: "current",
        header: "Сейчас",
        value: (product) => `${product.active} ${product.madeToOrder}`,
        cell: (product) => (
          <div className="product-availability-analysis__state">
            <AppBadge tone={product.active ? "green" : "red"}>
              {product.active ? "Активен" : "Скрыт"}
            </AppBadge>
            <AppBadge tone={product.madeToOrder ? "orange" : "slate"}>
              {product.madeToOrder ? "Под заказ" : "Не под заказ"}
            </AppBadge>
          </div>
        ),
      },
      {
        id: "after",
        header: "Станет",
        value: (product) => product.correctedNameRu,
        cell: (product) => (
          <div className="product-availability-analysis__after">
            <strong>{product.correctedNameRu}</strong>
            <AppBadge tone="orange">Под заказ · доступен клиентам</AppBadge>
          </div>
        ),
      },
    ],
    [],
  );

  function runAnalysis() {
    if (draftKeywords.length === 0) {
      appToast.error("Укажите хотя бы одно ключевое слово");
      return;
    }
    if (draftKeywords.join("\n") === analyzedKeywords.join("\n")) {
      void preview.refetch();
      return;
    }
    setAnalyzedKeywords(draftKeywords);
  }

  return (
    <AdminPage
      title="Анализ доступности товаров"
      eyebrow="Настройки"
      actions={
        <AppButton asChild variant="secondary">
          <Link to="/admin/settings">
            <ArrowLeft size={17} />К настройкам
          </Link>
        </AppButton>
      }
    >
      <div className="product-availability-analysis">
        <DataPanel
          title="Ключевые слова для анализа"
          actions={
            <AppButton
              type="button"
              variant="secondary"
              disabled={preview.isFetching || draftKeywords.length === 0}
              onClick={runAnalysis}
            >
              <RefreshCw size={17} />
              Запустить анализ
            </AppButton>
          }
        >
          <div className="admin-panel-body product-availability-analysis__intro">
            <p className="admin-panel-text">
              Укажите слова или фразы, которые нужно найти в названии товара. Регистр не
              учитывается. После подтверждения найденные фразы будут удалены, а товар станет
              активным и доступным под заказ.
            </p>
            <AppTextarea
              label="Ключевые слова"
              hint="По одному слову или фразе на строку. Например: «нет в наличии», «временно отсутствует»."
              value={keywordsDraft}
              rows={4}
              onChange={(event) => setKeywordsDraft(event.target.value)}
            />
            <AppAlert title="Сначала только предпросмотр" tone="info">
              Никакие данные не меняются, пока вы не подтвердите применение результатов.
            </AppAlert>
          </div>
        </DataPanel>

        <DataPanel
          title="Результаты анализа"
          actions={
            <AppBadge tone={candidates.length > 0 ? "orange" : "green"}>
              {candidates.length === 1 ? "1 позиция" : `${candidates.length} позиций`}
            </AppBadge>
          }
        >
          {preview.isError ? (
            <div className="admin-panel-body">
              <AppAlert title="Не удалось выполнить анализ" tone="danger" onRetry={preview.refetch}>
                Проверьте соединение с сервером и повторите попытку.
              </AppAlert>
            </div>
          ) : candidates.length === 0 && !preview.isLoading ? (
            <div className="admin-panel-body">
              <AppAlert title="Исправления не требуются" tone="success">
                Товаров с указанными ключевыми словами в названии не найдено.
              </AppAlert>
            </div>
          ) : (
            <>
              <AppDataTable
                data={candidates}
                columns={columns}
                rowId={(product) => String(product.id)}
                loading={preview.isLoading}
                selectable={false}
                emptyTitle="Подходящие товары не найдены"
                emptyDescription="После обновления анализа результаты появятся здесь."
              />
              {candidates.length > 0 && (
                <div className="admin-panel-footer">
                  <AppButton type="button" onClick={() => setConfirmOpen(true)}>
                    <ScanSearch size={17} />
                    Применить изменения: {candidates.length}
                  </AppButton>
                </div>
              )}
            </>
          )}
        </DataPanel>
      </div>

      <AppModal
        title="Применить изменения?"
        description={`Будет обновлено позиций: ${candidates.length}. Товары станут доступными под заказ, а найденные ключевые слова исчезнут из их названий.`}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        contentClassName="product-availability-analysis__confirm-modal"
      >
        <div className="product-availability-analysis__confirm-actions">
          <AppButton type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
            Отмена
          </AppButton>
          <AppButton
            type="button"
            loading={applyRepair.isPending}
            onClick={() => applyRepair.mutate(candidates.map((product) => product.id))}
          >
            <Check size={17} />
            Подтвердить и применить
          </AppButton>
        </div>
      </AppModal>
    </AdminPage>
  );
}
