import type { SupplierImportJob, SupplierSyncStatus } from "@/shared/api/supplierProducts";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppAlert } from "@/shared/ui/AppFeedback";
import "./SupplierImportQueue.css";

const statuses: Record<SupplierImportJob["status"], string> = {
  QUEUED: "В очереди",
  DISCOVERING: "Собираем товары",
  RUNNING: "Загружаем товары",
  COMPLETED: "Завершён",
  FAILED: "Ошибка импорта",
};
const scopes: Record<SupplierImportJob["scope"], string> = {
  SELECTED: "Выбранные товары",
  FILTERED: "Товары по фильтрам",
  ALL: "Весь каталог",
};
export function SupplierImportQueue({
  jobs,
  loading,
  error,
  updatedAt,
  canRetry,
  retryingId,
  retryError,
  onRefresh,
  onRetry,
  syncStatus,
  syncError,
}: {
  jobs: SupplierImportJob[];
  syncStatus?: SupplierSyncStatus;
  syncError?: string;
  loading: boolean;
  error?: string;
  updatedAt: number;
  canRetry: boolean;
  retryingId?: number;
  retryError?: string;
  onRefresh: () => void;
  onRetry: (id: number) => void;
}) {
  return (
    <AppCard
      className="supplier-import-queue"
      title="Очередь импорта"
      description="Товары постепенно сохраняются в каталоге поставщиков. Очередь обновляется автоматически каждые 5 секунд. Цены и наличие импортированных товаров синхронизируются раз в сутки."
      actions={
        <AppButton type="button" variant="secondary" onClick={onRefresh} disabled={loading}>
          Обновить
        </AppButton>
      }
    >
      {syncStatus && (
        <div className="supplier-import-queue__summary">
          <dl className="supplier-import-queue__counts">
            <div>
              <dt>Товары поставщиков</dt>
              <dd>{syncStatus.totalProducts}</dd>
            </div>
            <div>
              <dt>Активные импорты</dt>
              <dd>{syncStatus.activeJobs}</dd>
            </div>
            <div>
              <dt>Ожидают загрузки</dt>
              <dd>{syncStatus.pending}</dd>
            </div>
            <div>
              <dt>Ошибки загрузки</dt>
              <dd>{syncStatus.failed}</dd>
            </div>
          </dl>
          <p className="supplier-import-queue__muted">
            Последнее обновление товаров:{" "}
            {syncStatus.lastSyncedAt
              ? new Date(syncStatus.lastSyncedAt).toLocaleString("ru-KZ", {
                  timeZone: "Asia/Almaty",
                })
              : "товары ещё не загружены"}
            .{" "}
            {syncStatus.nextSyncAt
              ? `Следующее обновление: ${new Date(syncStatus.nextSyncAt).toLocaleString("ru-KZ", { timeZone: "Asia/Almaty" })} (Алматы).`
              : "Регулярное обновление начнётся после первого импорта."}
          </p>
        </div>
      )}
      {syncError && (
        <AppAlert tone="warning" title="Сводка очереди недоступна">
          {syncError}
        </AppAlert>
      )}
      {error && (
        <AppAlert tone="danger" title="Не удалось обновить очередь" onRetry={onRefresh}>
          {error}
        </AppAlert>
      )}
      {retryError && (
        <AppAlert tone="danger" title="Не удалось повторить импорт">
          {retryError}
        </AppAlert>
      )}
      {loading && !jobs.length ? (
        <p role="status">Загружаем очередь…</p>
      ) : !jobs.length && !error ? (
        <p className="supplier-import-queue__muted">
          Очередь пуста. Выберите товары во вкладке МКС и добавьте их в импорт.
        </p>
      ) : null}
      <p className="supplier-import-queue__muted">Активные импорты и последние завершённые</p>
      <div className="supplier-import-queue__jobs">
        {jobs.map((job) => (
          <article key={job.id} className="supplier-import-queue__job">
            <div className="supplier-import-queue__heading">
              <strong>
                {job.supplierName} · Импорт №{job.id}
              </strong>
              <AppBadge
                tone={
                  job.status === "FAILED" ? "red" : job.status === "COMPLETED" ? "green" : "blue"
                }
              >
                {statuses[job.status]}
              </AppBadge>
            </div>
            <p className="supplier-import-queue__muted">
              {scopes[job.scope]} ·{" "}
              {new Date(job.createdAt).toLocaleString("ru-KZ", { timeZone: "Asia/Almaty" })}
            </p>
            <dl className="supplier-import-queue__counts">
              <div>
                <dt>Найдено</dt>
                <dd>{job.discovered}</dd>
              </div>
              <div>
                <dt>Загружено</dt>
                <dd>{job.processed}</dd>
              </div>
              <div>
                <dt>Ожидают</dt>
                <dd>{job.pending}</dd>
              </div>
              <div>
                <dt>Ошибки</dt>
                <dd>{job.failed}</dd>
              </div>
            </dl>
            {job.status === "DISCOVERING" && (
              <p className="supplier-import-queue__muted">
                Получаем список товаров поставщика. Общее количество уточняется по мере загрузки
                страниц.
              </p>
            )}
            {job.error && (
              <p role="alert" className="supplier-import-queue__error">
                {job.error}
              </p>
            )}
            {canRetry && job.status === "FAILED" && (
              <AppButton
                type="button"
                variant="secondary"
                disabled={retryingId !== undefined}
                loading={retryingId === job.id}
                onClick={() => onRetry(job.id)}
              >
                Повторить импорт
              </AppButton>
            )}
          </article>
        ))}
      </div>
      {updatedAt > 0 && (
        <p className="supplier-import-queue__updated">
          Обновлено: {new Date(updatedAt).toLocaleTimeString("ru-KZ", { timeZone: "Asia/Almaty" })}{" "}
          (Алматы)
        </p>
      )}
    </AppCard>
  );
}
