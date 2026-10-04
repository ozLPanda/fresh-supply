import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CircleDollarSign,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileClock,
  FileCheck2,
  FileText,
  History,
  Link2,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import {
  changeProcurementStatus,
  createProcurementCompany,
  addProcurementCompanyNote,
  createProcurementPayment,
  createProcurementProject,
  deleteProcurementCompany,
  deleteProcurementCompanyNote,
  deleteProcurementFile,
  deleteProcurementPayment,
  fetchProcurementProject,
  fetchProcurementCompanyNotes,
  fetchProcurementProjects,
  fetchProcurementStatusHistory,
  updateProcurementCompany,
  updateProcurementCompanyNote,
  updateProcurementProject,
  updateProcurementTextFile,
  uploadProcurementFile,
} from "@/shared/api/procurement";
import type {
  ProcurementCompany,
  ProcurementCompanyInput,
  ProcurementCompanyNote,
  ProcurementCompanyStatus,
  ProcurementFile,
  ProcurementPayment,
  ProcurementPaymentInput,
  ProcurementProject,
  ProcurementProjectInput,
  ProcurementProjectSummary,
  ProcurementStatus,
} from "@/shared/types/procurement";
import { API_URL } from "@/shared/api/http";
import { ALMATY_TIME_ZONE, todayInAlmaty } from "@/shared/lib/dateTime";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppFileUpload, AppTabs } from "@/shared/ui/AppControls";
import { AppAlert, AppModal, AppSkeleton } from "@/shared/ui/AppFeedback";
import {
  AppInput,
  AppMoneyInput,
  AppSearchInput,
  AppSelect,
  AppTextarea,
} from "@/shared/ui/AppField";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./ProcurementPages.css";

const STATUS_LABELS: Record<ProcurementStatus, string> = {
  DRAFT: "Черновик",
  IN_PROGRESS: "В работе",
  READY_FOR_REVIEW: "Готово к проверке",
  READY_FOR_PAYMENT: "Готово к оплате",
  PAID: "Оплачено",
  REWORK: "Доработка",
};

const STATUS_TONES: Record<ProcurementStatus, "slate" | "blue" | "orange" | "green" | "red"> = {
  DRAFT: "slate",
  IN_PROGRESS: "blue",
  READY_FOR_REVIEW: "orange",
  READY_FOR_PAYMENT: "orange",
  PAID: "green",
  REWORK: "red",
};

const STATUS_FLOW: Record<ProcurementStatus, ProcurementStatus[]> = {
  DRAFT: ["IN_PROGRESS"],
  IN_PROGRESS: ["READY_FOR_REVIEW"],
  READY_FOR_REVIEW: ["READY_FOR_PAYMENT", "REWORK"],
  READY_FOR_PAYMENT: ["PAID"],
  PAID: [],
  REWORK: ["IN_PROGRESS"],
};

type ProcurementCompanyPriceCurrency = NonNullable<ProcurementCompany["priceCurrency"]>;

const COMPANY_PRICE_CURRENCIES: Array<{
  value: ProcurementCompanyPriceCurrency;
  label: string;
}> = [
  { value: "KZT", label: "Тенге (₸)" },
  { value: "USD", label: "Доллары (USD)" },
  { value: "CNY", label: "RMB (¥)" },
];

const COMPANY_PRICE_CURRENCY_LABELS: Record<ProcurementCompanyPriceCurrency, string> = {
  KZT: "₸",
  USD: "USD",
  CNY: "RMB",
};

const COMPANY_STATUS_LABELS: Record<ProcurementCompanyStatus, string> = {
  FOUND: "Найдена",
  AWAITING_DOCUMENTS: "Ждём документы",
  OFFER_RECEIVED: "Предложение получено",
  SELECTED: "Выбрана",
  REJECTED: "Отклонена",
};

const COMPANY_STATUS_TONES: Record<
  ProcurementCompanyStatus,
  "slate" | "blue" | "orange" | "green" | "red"
> = {
  FOUND: "slate",
  AWAITING_DOCUMENTS: "blue",
  OFFER_RECEIVED: "orange",
  SELECTED: "green",
  REJECTED: "red",
};

const COMPANY_STATUS_OPTIONS = Object.entries(COMPANY_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const EMPTY_PROJECT: ProcurementProjectInput = { name: "", purchaseInformation: "" };
const EMPTY_COMPANY: ProcurementCompanyInput = {
  name: "",
  price: null,
  priceCurrency: null,
  companyStatus: "FOUND",
  decisionComment: "",
  market: "",
  marketSinceYear: null,
  reviewsFromYear: null,
  reviewsToYear: null,
  comment: "",
  links: [{ name: "", url: "" }],
};
const EMPTY_PAYMENT: ProcurementPaymentInput = {
  amount: 0,
  currency: "CNY",
  paidAt: todayInAlmaty(),
  comment: "",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие";
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-KZ", {
    dateStyle: "medium",
    timeZone: ALMATY_TIME_ZONE,
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}

function formatMoney(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value);
}

function formatCompanyPrice(price?: number | null, currency?: ProcurementCompany["priceCurrency"]) {
  if (price === null || price === undefined) return "—";
  return `${formatMoney(price)} ${COMPANY_PRICE_CURRENCY_LABELS[currency ?? "KZT"]}`;
}

function formatPaymentBreakdown(payments: ProcurementPayment[]) {
  const totals = new Map<string, number>();
  payments.forEach((payment) => {
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0) + payment.amount);
  });
  return [...totals.entries()].map(([currency, amount]) => `${formatMoney(amount)} ${currency}`);
}

function getFileUrl(projectId: number, file: ProcurementFile) {
  // Documents are downloaded through an authenticated API endpoint, never from a public object URL.
  return `${API_URL}/api/admin/procurement/${projectId}/files/${file.id}/download`;
}

type FilePreviewData =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "image"; url: string }
  | { kind: "pdf"; url: string }
  | { kind: "audio"; url: string }
  | { kind: "video"; url: string }
  | { kind: "text"; text: string }
  | { kind: "document"; html: string }
  | { kind: "spreadsheet"; sheets: Array<{ name: string; html: string }> }
  | { kind: "unsupported"; message: string };

function fileExtension(file: ProcurementFile) {
  const name = file.originalFileName || file.displayName;
  const dotIndex = name.lastIndexOf(".");
  return dotIndex === -1 ? "" : name.slice(dotIndex + 1).toLowerCase();
}

function previewKind(file: ProcurementFile, contentType: string) {
  const extension = fileExtension(file);
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf" || extension === "pdf") return "pdf";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "video";
  if (extension === "docx") return "document";
  if (["xlsx", "xls", "csv"].includes(extension)) return "spreadsheet";
  if (
    contentType.startsWith("text/") ||
    ["txt", "md", "json", "xml", "yaml", "yml", "log", "rtf"].includes(extension)
  ) {
    return "text";
  }
  return "unsupported";
}

function sanitizePreviewHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll("script, iframe, object, embed, form, style, link, meta")
    .forEach((node) => {
      node.remove();
    });
  document.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        ((name === "href" || name === "src") && !/^(https?:|mailto:|#|data:image\/)/.test(value))
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return document.body.innerHTML;
}

function StatusBadge({ status }: { status: ProcurementStatus }) {
  return <AppBadge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</AppBadge>;
}

function CompanyStatusBadge({ status }: { status?: ProcurementCompanyStatus | null }) {
  const safeStatus = status ?? "FOUND";
  return (
    <AppBadge tone={COMPANY_STATUS_TONES[safeStatus]}>{COMPANY_STATUS_LABELS[safeStatus]}</AppBadge>
  );
}

export function ProcurementProjectsPage() {
  const [status, setStatus] = useState<ProcurementStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["procurement-projects", status, search],
    queryFn: () =>
      fetchProcurementProjects({ status: status === "ALL" ? undefined : status, search }),
  });
  const projects = projectsQuery.data?.items ?? [];

  return (
    <AdminPage
      title="Закупки из Китая"
      eyebrow="Поставщики и закупки"
      actions={
        <AppButton asChild>
          <Link to="/admin/procurement/new">
            <Plus size={18} />
            Создать проект
          </Link>
        </AppButton>
      }
    >
      <div className="metric-grid procurement-metrics">
        <MetricCard
          icon={<ClipboardList size={18} />}
          label="Всего проектов"
          value={projects.length}
          size="compact"
        />
        <MetricCard
          icon={<Building2 size={18} />}
          label="Компаний"
          value={projects.reduce((total, item) => total + item.companiesCount, 0)}
          size="compact"
        />
        <MetricCard
          icon={<FileClock size={18} />}
          label="На проверке"
          value={projects.filter((item) => item.status === "READY_FOR_REVIEW").length}
          accent
          size="compact"
        />
      </div>
      <DataPanel
        title="Проекты"
        className="procurement-list-panel"
        actions={
          <div className="procurement-list-filters">
            <AppSearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по названию"
              aria-label="Поиск проектов"
            />
            <AppSelect
              value={status}
              onValueChange={(value) => setStatus(value as ProcurementStatus | "ALL")}
              options={[
                { value: "ALL", label: "Все статусы" },
                ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
              ]}
              ariaLabel="Статус проекта"
            />
          </div>
        }
      >
        {projectsQuery.isLoading ? (
          <AppSkeleton />
        ) : projectsQuery.error ? (
          <AppAlert title="Не удалось загрузить проекты" tone="danger">
            {errorMessage(projectsQuery.error)}
          </AppAlert>
        ) : projects.length ? (
          <div className="procurement-project-list">
            {projects.map((project) => (
              <ProjectListCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className="procurement-empty procurement-empty--project-list">
            <strong>Проектов пока нет</strong>
            <span>Создайте первый проект для поиска поставщиков и ведения закупки.</span>
          </div>
        )}
      </DataPanel>
    </AdminPage>
  );
}

function projectNextAction(status: ProcurementStatus) {
  const next = STATUS_FLOW[status][0];
  if (!next) return "Проект завершён";
  if (status === "REWORK") return "Верните проект в работу после доработки";
  return `Следующий шаг: ${STATUS_LABELS[next]}`;
}

function ProjectListCard({ project }: { project: ProcurementProjectSummary }) {
  return (
    <Link className="procurement-project-card" to={`/admin/procurement/${project.id}`}>
      <div className="procurement-project-card__main">
        <div className="procurement-project-card__title">
          <strong>{project.name}</strong>
          <span>Обновлён {formatDate(project.updatedAt, true)}</span>
        </div>
        <StatusBadge status={project.status} />
      </div>
      <dl className="procurement-project-card__metrics">
        <div>
          <dt>Компании</dt>
          <dd>{project.companiesCount}</dd>
        </div>
        <div>
          <dt>Оплачено</dt>
          <dd>{project.totalPaid ? "Есть оплаты" : "—"}</dd>
        </div>
        <div>
          <dt>Рабочий этап</dt>
          <dd>{projectNextAction(project.status)}</dd>
        </div>
      </dl>
      <span className="procurement-project-card__open">
        Открыть <ExternalLink size={15} />
      </span>
    </Link>
  );
}

export function ProcurementProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = projectId === "new";
  const id = Number(projectId);
  const projectQuery = useQuery({
    queryKey: ["procurement-project", id],
    queryFn: () => fetchProcurementProject(id),
    enabled: !isNew && Number.isFinite(id),
  });
  const project = projectQuery.data;
  const [form, setForm] = useState<ProcurementProjectInput>(EMPTY_PROJECT);
  const [statusTarget, setStatusTarget] = useState<ProcurementStatus | null>(null);
  const [statusComment, setStatusComment] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (project)
      setForm({ name: project.name, purchaseInformation: project.purchaseInformation ?? "" });
  }, [project]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["procurement-project", id] });
    void queryClient.invalidateQueries({ queryKey: ["procurement-projects"] });
  };
  const saveProject = useMutation({
    mutationFn: () => (isNew ? createProcurementProject(form) : updateProcurementProject(id, form)),
    onSuccess: (saved) => {
      appToast.success(isNew ? "Проект создан" : "Изменения сохранены");
      if (isNew) navigate(`/admin/procurement/${saved.id}`);
      else refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const changeStatus = useMutation({
    mutationFn: () => changeProcurementStatus(id, statusTarget!, statusComment),
    onSuccess: () => {
      appToast.success("Статус проекта изменён");
      setStatusTarget(null);
      setStatusComment("");
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });

  function submitProject(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      appToast.error("Укажите наименование проекта");
      return;
    }
    saveProject.mutate();
  }
  if (!isNew && projectQuery.isLoading)
    return (
      <AdminPage title="Закупки из Китая" eyebrow="Поставщики и закупки">
        <AppSkeleton />
      </AdminPage>
    );
  if (!isNew && !project)
    return (
      <AdminPage
        title="Проект не найден"
        eyebrow="Закупки из Китая"
        backAction={
          <AppButton variant="ghost" aria-label="К проектам" asChild>
            <Link to="/admin/procurement">
              <ArrowLeft size={24} aria-hidden="true" />
            </Link>
          </AppButton>
        }
      >
        <AppAlert title="Не удалось открыть проект" tone="danger">
          {errorMessage(projectQuery.error)}
        </AppAlert>
      </AdminPage>
    );

  const title = isNew ? "Новый проект" : project!.name;
  return (
    <AdminPage
      title={title}
      eyebrow="Закупки из Китая"
      backAction={
        <AppButton type="button" variant="ghost" aria-label="К проектам" asChild>
          <Link to="/admin/procurement">
            <ArrowLeft size={24} aria-hidden="true" />
          </Link>
        </AppButton>
      }
      actions={
        !isNew && project ? (
          <div className="procurement-heading-actions">
            <StatusBadge status={project.status} />
            {STATUS_FLOW[project.status][0] ? (
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => setStatusTarget(STATUS_FLOW[project.status][0])}
              >
                {project.status === "REWORK"
                  ? "Вернуть в работу"
                  : `Следующий этап: ${STATUS_LABELS[STATUS_FLOW[project.status][0]]}`}
              </AppButton>
            ) : null}
            <AppButton type="button" variant="secondary" onClick={() => setHistoryOpen(true)}>
              <History size={17} />
              История
            </AppButton>
          </div>
        ) : undefined
      }
    >
      {isNew ? (
        <ProjectGeneralForm
          form={form}
          setForm={setForm}
          onSubmit={submitProject}
          saving={saveProject.isPending}
          submitLabel="Создать проект"
        />
      ) : (
        <ProjectDetail
          project={project!}
          form={form}
          setForm={setForm}
          onSubmit={submitProject}
          saving={saveProject.isPending}
          onStatusChange={setStatusTarget}
          onOpenHistory={() => setHistoryOpen(true)}
          refresh={refresh}
        />
      )}
      {!isNew && project && (
        <>
          <AppModal
            open={statusTarget !== null}
            onOpenChange={(open) => {
              if (!open) {
                setStatusTarget(null);
                setStatusComment("");
              }
            }}
            title={statusTarget === "REWORK" ? "Вернуть на доработку" : "Изменить статус"}
            description={
              statusTarget === "REWORK"
                ? "Укажите причину возврата: комментарий будет сохранён в истории статусов."
                : `Перевести проект в статус «${statusTarget ? STATUS_LABELS[statusTarget] : ""}»?`
            }
            contentClassName="procurement-modal"
          >
            <form
              className="procurement-modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (statusTarget === "REWORK" && !statusComment.trim()) {
                  appToast.error("Укажите комментарий для доработки");
                  return;
                }
                changeStatus.mutate();
              }}
            >
              <AppTextarea
                label="Комментарий"
                required={statusTarget === "REWORK"}
                value={statusComment}
                onChange={(event) => setStatusComment(event.target.value)}
                placeholder={
                  statusTarget === "REWORK" ? "Что необходимо доработать" : "Необязательно"
                }
              />
              <div className="procurement-modal-actions">
                <AppButton type="button" variant="neutral" onClick={() => setStatusTarget(null)}>
                  Отмена
                </AppButton>
                <AppButton type="submit" loading={changeStatus.isPending}>
                  Изменить статус
                </AppButton>
              </div>
            </form>
          </AppModal>
          <StatusHistoryModal
            projectId={project.id}
            open={historyOpen}
            onOpenChange={setHistoryOpen}
          />
        </>
      )}
    </AdminPage>
  );
}

function ProjectGeneralForm({
  form,
  setForm,
  onSubmit,
  saving,
  submitLabel,
}: {
  form: ProcurementProjectInput;
  setForm: (form: ProcurementProjectInput) => void;
  onSubmit: (event: FormEvent) => void;
  saving: boolean;
  submitLabel: string;
}) {
  return (
    <DataPanel title="Основная информация" className="procurement-general-panel">
      <form className="procurement-form" onSubmit={onSubmit}>
        <AppInput
          label="Наименование проекта"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Например, поставка упаковки"
        />
        <AppTextarea
          label="Информация для закупа"
          value={form.purchaseInformation ?? ""}
          onChange={(event) => setForm({ ...form, purchaseInformation: event.target.value })}
          placeholder="Требования, объёмы, сроки, характеристики"
          rows={7}
        />
        <div className="procurement-form-actions">
          <AppButton type="submit" loading={saving}>
            <Save size={17} />
            {submitLabel}
          </AppButton>
        </div>
      </form>
    </DataPanel>
  );
}

function ProjectDetail({
  project,
  form,
  setForm,
  onSubmit,
  saving,
  onStatusChange,
  onOpenHistory,
  refresh,
}: {
  project: ProcurementProject;
  form: ProcurementProjectInput;
  setForm: (form: ProcurementProjectInput) => void;
  onSubmit: (event: FormEvent) => void;
  saving: boolean;
  onStatusChange: (status: ProcurementStatus) => void;
  onOpenHistory: () => void;
  refresh: () => void;
}) {
  const companiesWithPrice = project.companies.filter((company) => company.price != null).length;
  const paymentBreakdown = formatPaymentBreakdown(project.payments);
  const nextAction = projectNextAction(project.status);
  return (
    <div className="procurement-workspace">
      <section className="procurement-workspace__overview" aria-label="Сводка проекта">
        <div className="procurement-workspace__metrics">
          <div>
            <span>Компании</span>
            <strong>{project.companies.length}</strong>
            <small>с ценой: {companiesWithPrice}</small>
          </div>
          <div>
            <span>Документы</span>
            <strong>
              {project.files.length +
                project.companies.reduce((sum, item) => sum + item.files.length, 0)}
            </strong>
            <small>в проекте и у компаний</small>
          </div>
          <div>
            <span>Оплаты</span>
            <strong>{project.payments.length}</strong>
            <small>
              {paymentBreakdown.length ? paymentBreakdown.join(" · ") : "ещё не добавлены"}
            </small>
          </div>
        </div>
        <aside className="procurement-workspace__next-step">
          <span>Следующий шаг</span>
          <strong>{nextAction}</strong>
          <p>
            {project.status === "DRAFT"
              ? "Добавьте компании и начните работу по проекту."
              : "Проверьте заполненность предложений и документов перед переходом на следующий этап."}
          </p>
        </aside>
      </section>
      <AppTabs
        variant="card"
        items={[
          {
            value: "general",
            label: "Общее",
            icon: <ClipboardList size={16} />,
            content: (
              <>
                <ProjectGeneralForm
                  form={form}
                  setForm={setForm}
                  onSubmit={onSubmit}
                  saving={saving}
                  submitLabel="Сохранить изменения"
                />
                <StatusActions
                  status={project.status}
                  onChange={onStatusChange}
                  onHistory={onOpenHistory}
                />
              </>
            ),
          },
          {
            value: "companies",
            label: "Компании",
            count: project.companies.length,
            icon: <Building2 size={16} />,
            content: <CompaniesSection project={project} refresh={refresh} />,
          },
          {
            value: "files",
            label: "Помощь в поиске",
            count: project.files.length,
            icon: <FileText size={16} />,
            content: (
              <FilesSection projectId={project.id} files={project.files} refresh={refresh} />
            ),
          },
          {
            value: "payments",
            label: "Оплаты",
            count: project.payments.length,
            icon: <CircleDollarSign size={16} />,
            content: <PaymentsSection project={project} refresh={refresh} />,
          },
        ]}
      />
    </div>
  );
}

function StatusActions({
  status,
  onChange,
  onHistory,
}: {
  status: ProcurementStatus;
  onChange: (status: ProcurementStatus) => void;
  onHistory: () => void;
}) {
  return (
    <DataPanel
      title="Статус проекта"
      className="procurement-status-panel"
      actions={
        <AppButton type="button" variant="ghost" onClick={onHistory}>
          <History size={16} />
          История
        </AppButton>
      }
    >
      <div className="procurement-status-actions">
        <div>
          <StatusBadge status={status} />
          <p>Доступны только следующие этапы маршрута.</p>
        </div>
        <div>
          {STATUS_FLOW[status].map((next) => (
            <AppButton
              key={next}
              type="button"
              variant={next === "REWORK" ? "secondary" : "primary"}
              onClick={() => onChange(next)}
            >
              {next === "REWORK" ? "На доработку" : `Перевести: ${STATUS_LABELS[next]}`}
            </AppButton>
          ))}
        </div>
      </div>
    </DataPanel>
  );
}

function CompaniesSection({
  project,
  refresh,
}: {
  project: ProcurementProject;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState<ProcurementCompany | null | undefined>(undefined);
  const [removing, setRemoving] = useState<ProcurementCompany | null>(null);
  const [notesCompany, setNotesCompany] = useState<ProcurementCompany | null>(null);
  const [detailsCompanyId, setDetailsCompanyId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProcurementCompanyStatus | "ALL">("ALL");
  const visibleCompanies = useMemo(() => {
    return project.companies.filter((company) => {
      const matchesStatus =
        statusFilter === "ALL" || (company.companyStatus ?? "FOUND") === statusFilter;
      const matchesSearch =
        !search.trim() ||
        adminMatchesSearch(
          [company.name, company.market, company.comment, company.price]
            .filter((value) => value !== null && value !== undefined)
            .join(" "),
          search,
        );
      return matchesStatus && matchesSearch;
    });
  }, [project.companies, search, statusFilter]);
  const detailsCompany =
    project.companies.find((company) => company.id === detailsCompanyId) ?? null;
  const openCompanyDetails = (company: ProcurementCompany) => setDetailsCompanyId(company.id);
  const remove = useMutation({
    mutationFn: (company: ProcurementCompany) => deleteProcurementCompany(project.id, company.id),
    onSuccess: () => {
      appToast.success("Компания удалена");
      setRemoving(null);
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  return (
    <DataPanel
      title="Компании"
      className="procurement-companies-panel"
      actions={
        <AppButton type="button" onClick={() => setEditing(null)}>
          <Plus size={17} />
          Добавить компанию
        </AppButton>
      }
    >
      <div className="procurement-company-toolbar">
        <AppSearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Найти компанию, рынок или комментарий"
          aria-label="Поиск компаний"
        />
        <AppSelect
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as ProcurementCompanyStatus | "ALL")}
          options={[{ value: "ALL", label: "Все этапы" }, ...COMPANY_STATUS_OPTIONS]}
          ariaLabel="Этап работы с компанией"
        />
      </div>
      {project.companies.length ? (
        <>
          <div className="procurement-company-table-wrap">
            <table className="procurement-company-table">
              <thead>
                <tr>
                  <th>Компания</th>
                  <th>Этап</th>
                  <th>Предложение</th>
                  <th>Заполненность</th>
                  <th>Рынок и отзывы</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {visibleCompanies.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <button
                        className="procurement-company-table__name"
                        type="button"
                        onClick={() => openCompanyDetails(company)}
                      >
                        <strong>{company.name}</strong>
                        <span>{company.market || "Рынок не указан"}</span>
                      </button>
                    </td>
                    <td>
                      <CompanyStatusBadge status={company.companyStatus} />
                    </td>
                    <td>
                      <strong>{formatCompanyPrice(company.price, company.priceCurrency)}</strong>
                    </td>
                    <td>
                      <CompanyCompleteness company={company} />
                    </td>
                    <td>
                      <span className="procurement-company-table__secondary">
                        {company.marketSinceYear ? `с ${company.marketSinceYear}` : "Год не указан"}
                        <br />
                        {company.reviewsFromYear || company.reviewsToYear
                          ? `Отзывы: ${company.reviewsFromYear ?? "—"}—${company.reviewsToYear ?? "—"}`
                          : "Отзывы не указаны"}
                      </span>
                    </td>
                    <td>
                      <CompanyActionButtons
                        company={company}
                        onDetails={openCompanyDetails}
                        onNotes={setNotesCompany}
                        onEdit={setEditing}
                        onDelete={setRemoving}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="procurement-company-mobile-list">
            {visibleCompanies.map((company) => (
              <article className="procurement-company-mobile-card" key={company.id}>
                <button type="button" onClick={() => openCompanyDetails(company)}>
                  <span>
                    <strong>{company.name}</strong>
                    <small>{company.market || "Рынок не указан"}</small>
                  </span>
                  <CompanyStatusBadge status={company.companyStatus} />
                </button>
                <dl>
                  <div>
                    <dt>Цена</dt>
                    <dd>{formatCompanyPrice(company.price, company.priceCurrency)}</dd>
                  </div>
                  <div>
                    <dt>Файлы и ссылки</dt>
                    <dd>
                      {company.files.length} / {company.links.length}
                    </dd>
                  </div>
                </dl>
                <CompanyActionButtons
                  company={company}
                  onDetails={openCompanyDetails}
                  onNotes={setNotesCompany}
                  onEdit={setEditing}
                  onDelete={setRemoving}
                />
              </article>
            ))}
          </div>
          {!visibleCompanies.length && (
            <div className="procurement-empty">По заданным условиям компании не найдены.</div>
          )}
        </>
      ) : (
        <div className="procurement-empty">
          Добавьте компании, которые рассматриваете для этого проекта.
        </div>
      )}
      <CompanyModal
        projectId={project.id}
        company={editing}
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        refresh={() => {
          setEditing(undefined);
          refresh();
        }}
      />
      <CompanyNotesModal
        projectId={project.id}
        company={notesCompany}
        onOpenChange={(open) => !open && setNotesCompany(null)}
      />
      <CompanyDetailsDrawer
        projectId={project.id}
        company={detailsCompany}
        refresh={refresh}
        onOpenChange={(open) => !open && setDetailsCompanyId(null)}
        onNotes={setNotesCompany}
        onEdit={setEditing}
        onDelete={setRemoving}
      />
      <AppModal
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Удалить компанию"
        description="Связанные ссылки и файлы также будут удалены."
        contentClassName="procurement-modal"
      >
        <div className="procurement-modal-actions">
          <AppButton type="button" variant="neutral" onClick={() => setRemoving(null)}>
            Отмена
          </AppButton>
          <AppButton
            type="button"
            variant="danger"
            loading={remove.isPending}
            onClick={() => removing && remove.mutate(removing)}
          >
            Удалить
          </AppButton>
        </div>
      </AppModal>
    </DataPanel>
  );
}

function CompanyCompleteness({ company }: { company: ProcurementCompany }) {
  const hasLink = company.links.length > 0;
  const hasFile = company.files.length > 0;
  return (
    <span className="procurement-company-completeness">
      <FileCheck2 size={15} aria-hidden="true" />
      {hasLink ? "Ссылка" : "Нет ссылки"} ·{" "}
      {hasFile ? `${company.files.length} файл.` : "Нет файлов"}
    </span>
  );
}

function CompanyActionButtons({
  company,
  onDetails,
  onNotes,
  onEdit,
  onDelete,
}: {
  company: ProcurementCompany;
  onDetails: (company: ProcurementCompany) => void;
  onNotes: (company: ProcurementCompany) => void;
  onEdit: (company: ProcurementCompany) => void;
  onDelete: (company: ProcurementCompany) => void;
}) {
  return (
    <div className="procurement-company-actions">
      <AppButton
        type="button"
        variant="ghost"
        aria-label={`Открыть ${company.name}`}
        onClick={() => onDetails(company)}
      >
        <Search size={16} />
      </AppButton>
      <AppButton
        type="button"
        variant="ghost"
        aria-label={`Открыть заметки: ${company.name}`}
        onClick={() => onNotes(company)}
      >
        <MessageSquare size={16} />
      </AppButton>
      <AppButton
        type="button"
        variant="ghost"
        aria-label={`Изменить ${company.name}`}
        onClick={() => onEdit(company)}
      >
        <Pencil size={16} />
      </AppButton>
      <AppButton
        type="button"
        variant="ghost"
        aria-label={`Удалить ${company.name}`}
        onClick={() => onDelete(company)}
      >
        <Trash2 size={16} />
      </AppButton>
    </div>
  );
}

function CompanyDetailsDrawer({
  projectId,
  company,
  refresh,
  onOpenChange,
  onNotes,
  onEdit,
  onDelete,
}: {
  projectId: number;
  company: ProcurementCompany | null;
  refresh: () => void;
  onOpenChange: (open: boolean) => void;
  onNotes: (company: ProcurementCompany) => void;
  onEdit: (company: ProcurementCompany) => void;
  onDelete: (company: ProcurementCompany) => void;
}) {
  return (
    <AppModal
      open={company !== null}
      onOpenChange={onOpenChange}
      title={company?.name ?? "Компания"}
      description="Карточка поставщика, материалы и рабочие заметки."
      contentClassName="procurement-modal procurement-company-modal procurement-company-details-modal"
    >
      {company ? (
        <div className="procurement-company-drawer__content">
          <div className="procurement-company-drawer__summary">
            <CompanyStatusBadge status={company.companyStatus} />
            <strong>{formatCompanyPrice(company.price, company.priceCurrency)}</strong>
            <span>{company.market || "Рынок не указан"}</span>
          </div>
          <dl className="procurement-company-drawer__facts">
            <div>
              <dt>На рынке</dt>
              <dd>{company.marketSinceYear ? `с ${company.marketSinceYear} года` : "—"}</dd>
            </div>
            <div>
              <dt>Отзывы</dt>
              <dd>
                {company.reviewsFromYear || company.reviewsToYear
                  ? `${company.reviewsFromYear ?? "—"} — ${company.reviewsToYear ?? "—"}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Ссылки</dt>
              <dd>{company.links.length}</dd>
            </div>
            <div>
              <dt>Документы</dt>
              <dd>{company.files.length}</dd>
            </div>
          </dl>
          {company.comment ? (
            <p className="procurement-company-card__comment">{company.comment}</p>
          ) : null}
          {company.decisionComment ? (
            <p className="procurement-company-drawer__decision">
              <strong>Решение:</strong> {company.decisionComment}
            </p>
          ) : null}
          <div className="procurement-company-drawer__links">
            <strong>Ссылки и контакты</strong>
            {company.links.length ? (
              company.links.map((link) => (
                <a key={link.id ?? link.url} href={link.url} target="_blank" rel="noreferrer">
                  <Link2 size={15} />
                  {link.name}
                </a>
              ))
            ) : (
              <span>Ссылки не добавлены</span>
            )}
          </div>
          <CompanyFiles projectId={projectId} company={company} refresh={refresh} />
          <div className="procurement-company-drawer__actions">
            <AppButton
              type="button"
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
                onNotes(company);
              }}
            >
              <MessageSquare size={16} />
              Заметки
            </AppButton>
            <AppButton
              type="button"
              variant="neutral"
              onClick={() => {
                onOpenChange(false);
                onEdit(company);
              }}
            >
              <Pencil size={16} />
              Изменить
            </AppButton>
            <AppButton
              type="button"
              variant="danger"
              onClick={() => {
                onOpenChange(false);
                onDelete(company);
              }}
            >
              <Trash2 size={16} />
              Удалить
            </AppButton>
          </div>
        </div>
      ) : null}
    </AppModal>
  );
}

function CompanyNotesModal({
  projectId,
  company,
  onOpenChange,
}: {
  projectId: number;
  company: ProcurementCompany | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useCommerce();
  const [content, setContent] = useState("");
  const [editingNote, setEditingNote] = useState<ProcurementCompanyNote | null>(null);
  const [removingNote, setRemovingNote] = useState<ProcurementCompanyNote | null>(null);
  useEffect(() => {
    setContent("");
    setEditingNote(null);
    setRemovingNote(null);
  }, [company?.id]);
  const notesQuery = useQuery({
    queryKey: ["procurement-company-notes", projectId, company?.id],
    queryFn: () => fetchProcurementCompanyNotes(projectId, company!.id),
    enabled: company !== null,
  });
  const addNote = useMutation({
    mutationFn: () => addProcurementCompanyNote(projectId, company!.id, content.trim()),
    onSuccess: async () => {
      setContent("");
      await notesQuery.refetch();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const updateNote = useMutation({
    mutationFn: () =>
      updateProcurementCompanyNote(projectId, company!.id, editingNote!.id, content.trim()),
    onSuccess: async () => {
      setContent("");
      setEditingNote(null);
      await notesQuery.refetch();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const deleteNote = useMutation({
    mutationFn: () => deleteProcurementCompanyNote(projectId, company!.id, removingNote!.id),
    onSuccess: async () => {
      setRemovingNote(null);
      await notesQuery.refetch();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) {
      appToast.error("Введите текст заметки");
      return;
    }
    if (editingNote) updateNote.mutate();
    else addNote.mutate();
  }

  function startEditing(note: ProcurementCompanyNote) {
    setEditingNote(note);
    setContent(note.content);
  }

  function cancelEditing() {
    setEditingNote(null);
    setContent("");
  }

  return (
    <AppModal
      open={company !== null}
      onOpenChange={onOpenChange}
      title={company ? `Заметки: ${company.name}` : "Заметки"}
      description="Фиксируйте цены, расчёты и договорённости по этой компании."
      contentClassName="procurement-modal procurement-notes-modal"
    >
      <div className="procurement-notes-chat">
        <div className="procurement-notes-chat__messages" aria-live="polite">
          {notesQuery.isLoading ? (
            <AppSkeleton />
          ) : notesQuery.error ? (
            <AppAlert title="Не удалось загрузить заметки" tone="danger">
              {errorMessage(notesQuery.error)}
            </AppAlert>
          ) : notesQuery.data?.length ? (
            notesQuery.data.map((note) => (
              <CompanyNoteMessage
                key={note.id}
                note={note}
                canManage={note.authorUserId === user?.id}
                onEdit={() => startEditing(note)}
                onDelete={() => setRemovingNote(note)}
              />
            ))
          ) : (
            <div className="procurement-empty">
              Заметок пока нет. Зафиксируйте цену, условия или следующий шаг.
            </div>
          )}
        </div>
        <form className="procurement-notes-chat__form" onSubmit={submit}>
          <AppTextarea
            label={editingNote ? "Редактирование заметки" : "Новая заметка"}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Например: цена 18 ¥ за единицу, минимальная партия — 500 шт."
            rows={3}
          />
          <div className="procurement-notes-chat__form-actions">
            {editingNote ? (
              <AppButton type="button" variant="neutral" onClick={cancelEditing}>
                Отменить
              </AppButton>
            ) : null}
            <AppButton type="submit" loading={addNote.isPending || updateNote.isPending}>
              <MessageSquare size={16} />
              {editingNote ? "Сохранить изменения" : "Добавить заметку"}
            </AppButton>
          </div>
        </form>
      </div>
      <AppModal
        open={removingNote !== null}
        onOpenChange={(open) => !open && setRemovingNote(null)}
        title="Удалить заметку?"
        description="Это действие нельзя отменить."
        contentClassName="procurement-modal"
      >
        <div className="procurement-modal-actions">
          <AppButton type="button" variant="neutral" onClick={() => setRemovingNote(null)}>
            Отменить
          </AppButton>
          <AppButton
            type="button"
            variant="danger"
            loading={deleteNote.isPending}
            onClick={() => deleteNote.mutate()}
          >
            Удалить
          </AppButton>
        </div>
      </AppModal>
    </AppModal>
  );
}

function CompanyNoteMessage({
  note,
  canManage,
  onEdit,
  onDelete,
}: {
  note: ProcurementCompanyNote;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="procurement-note-message">
      <header>
        <div>
          <strong>{note.authorName}</strong>
          <time>{formatDate(note.createdAt, true)}</time>
        </div>
        {canManage ? (
          <div className="procurement-note-message__actions">
            <AppButton
              type="button"
              variant="ghost"
              aria-label="Редактировать заметку"
              onClick={onEdit}
            >
              <Pencil size={15} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              aria-label="Удалить заметку"
              onClick={onDelete}
            >
              <Trash2 size={15} />
            </AppButton>
          </div>
        ) : null}
      </header>
      <p>{note.content}</p>
    </article>
  );
}

function CompanyModal({
  projectId,
  company,
  open,
  onOpenChange,
  refresh,
}: {
  projectId: number;
  company: ProcurementCompany | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refresh: () => void;
}) {
  const [form, setForm] = useState<ProcurementCompanyInput>(EMPTY_COMPANY);
  useEffect(() => {
    if (open)
      setForm(
        company
          ? {
              name: company.name,
              companyStatus: company.companyStatus ?? "FOUND",
              decisionComment: company.decisionComment ?? "",
              price: company.price ?? null,
              priceCurrency: company.price == null ? null : (company.priceCurrency ?? "KZT"),
              market: company.market ?? "",
              marketSinceYear: company.marketSinceYear ?? null,
              reviewsFromYear: company.reviewsFromYear ?? null,
              reviewsToYear: company.reviewsToYear ?? null,
              comment: company.comment ?? "",
              links: company.links.length
                ? company.links.map(({ name, url }) => ({ name, url }))
                : [{ name: "", url: "" }],
            }
          : EMPTY_COMPANY,
      );
  }, [company, open]);
  const save = useMutation({
    mutationFn: () => {
      const input: ProcurementCompanyInput = {
        ...form,
        price: form.price ?? null,
        priceCurrency: form.price == null ? null : (form.priceCurrency ?? "KZT"),
        links: form.links
          .filter((link) => link.name.trim() && link.url.trim())
          .map((link) => ({ ...link, name: link.name.trim(), url: link.url.trim() })),
      };
      return company
        ? updateProcurementCompany(projectId, company.id, input)
        : createProcurementCompany(projectId, input);
    },
    onSuccess: () => {
      appToast.success(company ? "Компания обновлена" : "Компания добавлена");
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const setYear = (key: "marketSinceYear" | "reviewsFromYear" | "reviewsToYear", value: string) =>
    setForm({ ...form, [key]: value ? Number(value) : null });
  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title={company ? "Изменить компанию" : "Новая компания"}
      contentClassName="procurement-modal procurement-company-modal"
    >
      <form
        className="procurement-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.name.trim()) {
            appToast.error("Укажите название компании");
            return;
          }
          if (form.companyStatus === "REJECTED" && !form.decisionComment?.trim()) {
            appToast.error("Укажите причину отклонения компании");
            return;
          }
          if (form.links.some((link) => Boolean(link.name.trim()) !== Boolean(link.url.trim()))) {
            appToast.error("Заполните название и адрес каждой ссылки либо очистите оба поля");
            return;
          }
          if (form.price !== null && form.price !== undefined) {
            if (!Number.isFinite(form.price) || form.price < 0) {
              appToast.error("Цена компании не может быть отрицательной");
              return;
            }
            if (Math.abs(form.price * 100 - Math.round(form.price * 100)) > 1e-8) {
              appToast.error("В цене можно указать не более двух знаков после запятой");
              return;
            }
          }
          if (
            form.reviewsFromYear &&
            form.reviewsToYear &&
            form.reviewsToYear < form.reviewsFromYear
          ) {
            appToast.error("Год окончания отзывов не может быть раньше начала");
            return;
          }
          save.mutate();
        }}
      >
        <AppInput
          label="Название компании"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <AppSelect
          label="Этап работы с компанией"
          value={form.companyStatus ?? "FOUND"}
          onValueChange={(value) =>
            setForm({ ...form, companyStatus: value as ProcurementCompanyStatus })
          }
          options={COMPANY_STATUS_OPTIONS}
        />
        <div className="procurement-price-grid">
          <AppMoneyInput
            label="Цена"
            value={form.price ?? null}
            onValueChange={(price) =>
              setForm({
                ...form,
                price,
                priceCurrency: price === null ? null : (form.priceCurrency ?? "KZT"),
              })
            }
            currency=""
          />
          <AppSelect
            label="Валюта"
            options={COMPANY_PRICE_CURRENCIES}
            value={form.priceCurrency ?? "KZT"}
            onValueChange={(value) => {
              if (typeof value === "string") {
                setForm({ ...form, priceCurrency: value as ProcurementCompanyPriceCurrency });
              }
            }}
          />
        </div>
        <div className="procurement-primary-link">
          <AppInput
            label="Ссылка на компанию"
            placeholder="https://"
            value={form.links[0]?.url ?? ""}
            onChange={(event) =>
              setForm({
                ...form,
                links: [
                  { name: form.links[0]?.name || "Основная ссылка", url: event.target.value },
                  ...form.links.slice(1),
                ],
              })
            }
          />
          <AppInput
            label="Подпись ссылки"
            placeholder="Например, официальный сайт"
            value={form.links[0]?.name ?? ""}
            onChange={(event) =>
              setForm({
                ...form,
                links: [
                  { name: event.target.value, url: form.links[0]?.url || "" },
                  ...form.links.slice(1),
                ],
              })
            }
          />
        </div>
        <AppTextarea
          label="Комментарий к решению"
          hint={
            form.companyStatus === "REJECTED"
              ? "Обязателен для отклонённой компании."
              : "Например, причина выбора или отказа."
          }
          required={form.companyStatus === "REJECTED"}
          value={form.decisionComment ?? ""}
          onChange={(event) => setForm({ ...form, decisionComment: event.target.value })}
          rows={2}
        />
        <details className="procurement-company-form-details">
          <summary>Дополнительные сведения</summary>
          <div className="procurement-company-form-details__content">
            <AppTextarea
              label="Рынок компании"
              value={form.market ?? ""}
              onChange={(event) => setForm({ ...form, market: event.target.value })}
              rows={2}
            />
            <div className="procurement-form-grid">
              <AppInput
                label="На рынке с года"
                type="number"
                value={form.marketSinceYear ?? ""}
                onChange={(event) => setYear("marketSinceYear", event.target.value)}
              />
              <AppInput
                label="Отзывы с года"
                type="number"
                value={form.reviewsFromYear ?? ""}
                onChange={(event) => setYear("reviewsFromYear", event.target.value)}
              />
              <AppInput
                label="Отзывы по год"
                type="number"
                value={form.reviewsToYear ?? ""}
                onChange={(event) => setYear("reviewsToYear", event.target.value)}
              />
            </div>
            <AppTextarea
              label="Рабочий комментарий"
              value={form.comment ?? ""}
              onChange={(event) => setForm({ ...form, comment: event.target.value })}
              rows={3}
            />
            <div className="procurement-links-editor">
              <div>
                <b>Дополнительные ссылки</b>
                <span>Название и адрес страницы компании</span>
              </div>
              {form.links.slice(1).map((link, index) => (
                <div className="procurement-link-row" key={link.id ?? index}>
                  <AppInput
                    aria-label="Название ссылки"
                    placeholder="Название"
                    value={link.name}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        links: form.links.map((item, itemIndex) =>
                          itemIndex === index + 1 ? { ...item, name: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <AppInput
                    aria-label="URL ссылки"
                    placeholder="https://"
                    value={link.url}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        links: form.links.map((item, itemIndex) =>
                          itemIndex === index + 1 ? { ...item, url: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <AppButton
                    type="button"
                    variant="ghost"
                    aria-label="Удалить ссылку"
                    onClick={() =>
                      setForm({
                        ...form,
                        links: form.links.filter((_, itemIndex) => itemIndex !== index + 1),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </AppButton>
                </div>
              ))}
              <AppButton
                type="button"
                variant="ghost"
                onClick={() => setForm({ ...form, links: [...form.links, { name: "", url: "" }] })}
              >
                <Plus size={16} />
                Добавить ссылку
              </AppButton>
            </div>
          </div>
        </details>
        <div className="procurement-modal-actions">
          <AppButton type="button" variant="neutral" onClick={() => onOpenChange(false)}>
            Отмена
          </AppButton>
          <AppButton type="submit" loading={save.isPending}>
            <Save size={16} />
            Сохранить
          </AppButton>
        </div>
      </form>
    </AppModal>
  );
}

function CompanyFiles({
  projectId,
  company,
  refresh,
}: {
  projectId: number;
  company: ProcurementCompany;
  refresh: () => void;
}) {
  const [pending, setPending] = useState<File[]>([]);
  const [displayName, setDisplayName] = useState("");
  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadProcurementFile(projectId, file, displayName.trim() || file.name, company.id),
    onSuccess: () => {
      appToast.success("Файл добавлен");
      setPending([]);
      setDisplayName("");
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (fileId: number) => deleteProcurementFile(projectId, fileId),
    onSuccess: () => {
      appToast.success("Файл удалён");
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  return (
    <div className="procurement-company-files">
      <div className="procurement-file-chips">
        {company.files.map((file) => (
          <span key={file.id} className="procurement-file-chip">
            <a href={getFileUrl(projectId, file)} target="_blank" rel="noreferrer">
              <FileText size={13} />
              {file.displayName}
            </a>
            <button
              type="button"
              disabled={remove.isPending}
              aria-label={`Удалить ${file.displayName}`}
              onClick={() => remove.mutate(file.id)}
            >
              <Trash2 size={12} />
            </button>
          </span>
        ))}
      </div>
      <AppFileUpload
        label="Прикрепить файл"
        onChange={(files) => {
          setPending(files);
          setDisplayName(files[0]?.name ?? "");
        }}
      />
      {pending[0] && (
        <div className="procurement-file-upload__controls">
          <AppInput
            label="Название для отображения"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <AppButton
            type="button"
            variant="ghost"
            loading={upload.isPending}
            onClick={() => upload.mutate(pending[0])}
          >
            <Upload size={15} />
            Загрузить
          </AppButton>
        </div>
      )}
    </div>
  );
}

function FilesSection({
  projectId,
  files,
  refresh,
}: {
  projectId: number;
  files: ProcurementFile[];
  refresh: () => void;
}) {
  const [pending, setPending] = useState<File[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [previewing, setPreviewing] = useState<ProcurementFile | null>(null);
  const upload = useMutation({
    mutationFn: () =>
      uploadProcurementFile(projectId, pending[0], displayName.trim() || pending[0].name),
    onSuccess: () => {
      appToast.success("Файл добавлен");
      setPending([]);
      setDisplayName("");
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (fileId: number) => deleteProcurementFile(projectId, fileId),
    onSuccess: () => {
      appToast.success("Файл удалён");
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  return (
    <DataPanel
      title="Материалы для поиска"
      className="procurement-files-panel"
      actions={<AppBadge tone="blue">{files.length} файлов</AppBadge>}
    >
      <div className="procurement-file-upload">
        <AppFileUpload
          label="Выбрать файл"
          multiple
          onChange={(selected) => {
            setPending(selected);
            if (selected[0]) setDisplayName(selected[0].name);
          }}
        />
        {pending[0] && (
          <div className="procurement-file-upload__controls">
            <AppInput
              label="Название файла"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <AppButton type="button" loading={upload.isPending} onClick={() => upload.mutate()}>
              <Upload size={16} />
              Загрузить
            </AppButton>
          </div>
        )}
      </div>
      <FileList
        projectId={projectId}
        files={files}
        onPreview={setPreviewing}
        onDelete={(file) => remove.mutate(file.id)}
        deleting={remove.isPending}
      />
      <FilePreviewModal
        projectId={projectId}
        file={previewing}
        onOpenChange={(open) => !open && setPreviewing(null)}
      />
    </DataPanel>
  );
}

function FileList({
  projectId,
  files,
  onPreview,
  onDelete,
  deleting,
}: {
  projectId: number;
  files: ProcurementFile[];
  onPreview?: (file: ProcurementFile) => void;
  onDelete?: (file: ProcurementFile) => void;
  deleting?: boolean;
}) {
  return (
    <div className="procurement-file-list">
      {files.length ? (
        files.map((file) => (
          <div className="procurement-file-item" key={file.id}>
            <AppButton
              type="button"
              variant="ghost"
              className="procurement-file-item__preview"
              onClick={() => onPreview?.(file)}
              aria-label={`Открыть предпросмотр ${file.displayName}`}
            >
              <FileText size={18} />
              <span>
                <strong>{file.displayName}</strong>
                <small>
                  {file.originalFileName} · {formatDate(file.createdAt)}
                </small>
              </span>
            </AppButton>
            <div className="procurement-file-item__actions">
              <AppButton variant="ghost" asChild aria-label={`Скачать ${file.displayName}`}>
                <a href={getFileUrl(projectId, file)} target="_blank" rel="noreferrer">
                  <Download size={16} />
                </a>
              </AppButton>
              {onDelete && (
                <AppButton
                  type="button"
                  variant="ghost"
                  aria-label={`Удалить ${file.displayName}`}
                  disabled={deleting}
                  onClick={() => onDelete(file)}
                >
                  <Trash2 size={16} />
                </AppButton>
              )}
            </div>
          </div>
        ))
      ) : (
        <div className="procurement-empty">Файлы ещё не добавлены.</div>
      )}
    </div>
  );
}

function FilePreviewModal({
  projectId,
  file,
  onOpenChange,
}: {
  projectId: number;
  file: ProcurementFile | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [preview, setPreview] = useState<FilePreviewData>({ kind: "loading" });
  const [activeSheet, setActiveSheet] = useState(0);
  const [editingText, setEditingText] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const saveTextMutation = useMutation({
    mutationFn: ({ fileId, text }: { fileId: number; text: string }) =>
      updateProcurementTextFile(projectId, fileId, text),
  });

  useEffect(() => {
    if (!file) {
      setPreview({ kind: "loading" });
      setEditingText(false);
      setTextDraft("");
      return;
    }
    const previewFile = file;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let isActive = true;
    setPreview({ kind: "loading" });
    setActiveSheet(0);
    setEditingText(false);
    setTextDraft("");

    async function loadPreview() {
      try {
        const response = await fetch(getFileUrl(projectId, previewFile), {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Не удалось загрузить файл для предпросмотра");
        const blob = await response.blob();
        const contentType = (blob.type || previewFile.contentType || "")
          .split(";", 1)[0]
          .toLowerCase();
        const kind = previewKind(previewFile, contentType);

        if (["image", "pdf", "audio", "video"].includes(kind)) {
          objectUrl = URL.createObjectURL(blob);
          if (isActive) setPreview({ kind, url: objectUrl } as FilePreviewData);
          return;
        }

        if (kind === "text") {
          const text = await blob.text();
          if (isActive) {
            setPreview({ kind: "text", text });
            setTextDraft(text);
          }
          return;
        }

        if (kind === "document") {
          const mammoth = await import("mammoth");
          const result = await mammoth.default.convertToHtml({
            arrayBuffer: await blob.arrayBuffer(),
          });
          if (isActive) setPreview({ kind: "document", html: sanitizePreviewHtml(result.value) });
          return;
        }

        if (kind === "spreadsheet") {
          const xlsx = await import("xlsx");
          const workbook = xlsx.read(await blob.arrayBuffer(), { type: "array" });
          const sheets = workbook.SheetNames.map((name) => ({
            name,
            html: sanitizePreviewHtml(xlsx.utils.sheet_to_html(workbook.Sheets[name])),
          }));
          if (isActive) {
            setPreview(
              sheets.length
                ? { kind: "spreadsheet", sheets }
                : { kind: "unsupported", message: "В таблице нет листов для предпросмотра." },
            );
          }
          return;
        }

        if (isActive) {
          setPreview({
            kind: "unsupported",
            message:
              "Для этого формата браузер не может показать содержимое. Скачайте файл, чтобы открыть его в подходящей программе.",
          });
        }
      } catch (error) {
        if (isActive && !(error instanceof DOMException && error.name === "AbortError")) {
          setPreview({
            kind: "error",
            message: error instanceof Error ? error.message : "Не удалось открыть предпросмотр",
          });
        }
      }
    }

    void loadPreview();
    return () => {
      isActive = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, projectId]);

  async function copyTextPreview() {
    if (preview.kind !== "text") return;

    try {
      await navigator.clipboard.writeText(editingText ? textDraft : preview.text);
      appToast.success("Текст скопирован");
    } catch {
      appToast.error("Не удалось скопировать текст");
    }
  }

  async function saveTextPreview() {
    if (!file || preview.kind !== "text") return;

    try {
      await saveTextMutation.mutateAsync({ fileId: file.id, text: textDraft });
      setPreview({ kind: "text", text: textDraft });
      setEditingText(false);
      appToast.success("Изменения сохранены");
    } catch (error) {
      appToast.error(errorMessage(error));
    }
  }

  const isTextFile =
    file !== null &&
    previewKind(file, (file.contentType || "").split(";", 1)[0].toLowerCase()) === "text";

  return (
    <AppModal
      open={file !== null}
      onOpenChange={onOpenChange}
      title={file?.displayName ?? "Предпросмотр файла"}
      description={
        file
          ? `${file.originalFileName} · ${fileExtension(file).toUpperCase() || "файл"}`
          : undefined
      }
      contentClassName="procurement-modal procurement-file-preview-modal"
    >
      <div className="procurement-file-preview">
        <div className="procurement-file-preview__toolbar">
          <span>Предпросмотр</span>
          {file ? (
            <div className="procurement-file-preview__actions">
              {isTextFile ? (
                <>
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={preview.kind !== "text"}
                    onClick={copyTextPreview}
                  >
                    <Copy size={16} />
                    Копировать
                  </AppButton>
                  {editingText && preview.kind === "text" ? (
                    <>
                      <AppButton
                        type="button"
                        variant="ghost"
                        disabled={saveTextMutation.isPending}
                        onClick={() => {
                          setTextDraft(preview.text);
                          setEditingText(false);
                        }}
                      >
                        Отменить
                      </AppButton>
                      <AppButton
                        type="button"
                        disabled={saveTextMutation.isPending || textDraft === preview.text}
                        loading={saveTextMutation.isPending}
                        loadingText="Сохраняем"
                        onClick={saveTextPreview}
                      >
                        <Save size={16} />
                        Сохранить
                      </AppButton>
                    </>
                  ) : (
                    <AppButton
                      type="button"
                      variant="secondary"
                      disabled={preview.kind !== "text"}
                      onClick={() => setEditingText(true)}
                    >
                      <Pencil size={16} />
                      Редактировать
                    </AppButton>
                  )}
                </>
              ) : null}
              <AppButton type="button" variant="secondary" asChild>
                <a href={getFileUrl(projectId, file)} target="_blank" rel="noreferrer">
                  <Download size={16} />
                  Скачать
                </a>
              </AppButton>
            </div>
          ) : null}
        </div>
        <div className="procurement-file-preview__body">
          {preview.kind === "loading" ? (
            <AppSkeleton />
          ) : preview.kind === "error" ? (
            <AppAlert title="Не удалось открыть предпросмотр" tone="danger">
              {preview.message}
            </AppAlert>
          ) : preview.kind === "unsupported" ? (
            <AppAlert title="Предпросмотр недоступен" tone="info">
              {preview.message}
            </AppAlert>
          ) : preview.kind === "image" ? (
            <img
              className="procurement-file-preview__image"
              src={preview.url}
              alt={file?.displayName}
            />
          ) : preview.kind === "pdf" ? (
            <iframe
              className="procurement-file-preview__frame"
              src={preview.url}
              title={file?.displayName}
            />
          ) : preview.kind === "audio" ? (
            <audio className="procurement-file-preview__media" controls src={preview.url} />
          ) : preview.kind === "video" ? (
            <video className="procurement-file-preview__video" controls src={preview.url} />
          ) : preview.kind === "text" ? (
            editingText ? (
              <AppTextarea
                className="procurement-file-preview__editor"
                fieldClassName="procurement-file-preview__editor-field"
                label="Содержимое файла"
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
              />
            ) : (
              <pre className="procurement-file-preview__text">{preview.text}</pre>
            )
          ) : preview.kind === "document" ? (
            <article
              className="procurement-file-preview__document"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          ) : (
            <div className="procurement-file-preview__spreadsheet">
              {preview.sheets.length > 1 ? (
                <div
                  className="procurement-file-preview__sheets"
                  role="tablist"
                  aria-label="Листы таблицы"
                >
                  {preview.sheets.map((sheet, index) => (
                    <AppButton
                      type="button"
                      variant={activeSheet === index ? "secondary" : "ghost"}
                      key={sheet.name}
                      role="tab"
                      aria-selected={activeSheet === index}
                      onClick={() => setActiveSheet(index)}
                    >
                      {sheet.name}
                    </AppButton>
                  ))}
                </div>
              ) : null}
              <div
                className="procurement-file-preview__sheet"
                dangerouslySetInnerHTML={{ __html: preview.sheets[activeSheet]?.html ?? "" }}
              />
            </div>
          )}
        </div>
      </div>
    </AppModal>
  );
}

function PaymentsSection({
  project,
  refresh,
}: {
  project: ProcurementProject;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProcurementPaymentInput>(EMPTY_PAYMENT);
  const [removing, setRemoving] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: () => createProcurementPayment(project.id, form),
    onSuccess: () => {
      appToast.success("Оплата добавлена");
      setOpen(false);
      setForm(EMPTY_PAYMENT);
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (paymentId: number) => deleteProcurementPayment(project.id, paymentId),
    onSuccess: () => {
      appToast.success("Оплата удалена");
      setRemoving(null);
      refresh();
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const paymentBreakdown = formatPaymentBreakdown(project.payments);
  return (
    <DataPanel
      title="Оплаты"
      className="procurement-payments-panel"
      actions={
        project.status === "PAID" ? (
          <AppButton type="button" onClick={() => setOpen(true)}>
            <Plus size={17} />
            Добавить оплату
          </AppButton>
        ) : (
          <AppBadge tone="slate">Доступно после оплаты</AppBadge>
        )
      }
    >
      <div className="procurement-payment-total">
        <span>Итого оплачено</span>
        <strong>{paymentBreakdown.length ? paymentBreakdown.join(" · ") : "—"}</strong>
      </div>
      <div className="procurement-payment-list">
        {project.payments.length ? (
          project.payments.map((payment) => (
            <div key={payment.id}>
              <span>
                <strong>
                  {formatMoney(payment.amount)} {payment.currency}
                </strong>
                <small>
                  {formatDate(payment.paidAt)}
                  {payment.comment ? ` · ${payment.comment}` : ""}
                </small>
              </span>
              <AppButton
                type="button"
                variant="ghost"
                aria-label="Удалить оплату"
                onClick={() => setRemoving(payment.id)}
              >
                <Trash2 size={16} />
              </AppButton>
            </div>
          ))
        ) : (
          <div className="procurement-empty">Записей об оплате пока нет.</div>
        )}
      </div>
      <AppModal
        open={open}
        onOpenChange={setOpen}
        title="Добавить оплату"
        contentClassName="procurement-modal"
      >
        <form
          className="procurement-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (form.amount <= 0) {
              appToast.error("Укажите сумму больше нуля");
              return;
            }
            save.mutate();
          }}
        >
          <div className="procurement-form-grid">
            <AppMoneyInput
              label="Сумма"
              required
              value={form.amount}
              onValueChange={(amount) => setForm({ ...form, amount: amount ?? 0 })}
              currency={form.currency || "¥"}
            />
            <AppInput
              label="Валюта"
              required
              maxLength={12}
              value={form.currency}
              onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
            />
            <AppInput
              label="Дата оплаты"
              required
              type="date"
              value={form.paidAt}
              onChange={(event) => setForm({ ...form, paidAt: event.target.value })}
            />
          </div>
          <AppTextarea
            label="Комментарий"
            value={form.comment ?? ""}
            onChange={(event) => setForm({ ...form, comment: event.target.value })}
          />
          <div className="procurement-modal-actions">
            <AppButton type="button" variant="neutral" onClick={() => setOpen(false)}>
              Отмена
            </AppButton>
            <AppButton type="submit" loading={save.isPending}>
              Добавить
            </AppButton>
          </div>
        </form>
      </AppModal>
      <AppModal
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Удалить оплату"
        description="Запись об оплате будет удалена."
        contentClassName="procurement-modal"
      >
        <div className="procurement-modal-actions">
          <AppButton type="button" variant="neutral" onClick={() => setRemoving(null)}>
            Отмена
          </AppButton>
          <AppButton
            type="button"
            variant="danger"
            loading={remove.isPending}
            onClick={() => removing && remove.mutate(removing)}
          >
            Удалить
          </AppButton>
        </div>
      </AppModal>
    </DataPanel>
  );
}

function StatusHistoryModal({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ["procurement-status-history", projectId],
    queryFn: () => fetchProcurementStatusHistory(projectId),
    enabled: open,
  });
  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title="История статусов"
      description="Все изменения статуса проекта фиксируются автоматически."
      contentClassName="procurement-modal procurement-history-modal"
    >
      <div className="procurement-history-list">
        {query.isLoading ? (
          <AppSkeleton />
        ) : query.error ? (
          <AppAlert title="Не удалось загрузить историю" tone="danger">
            {errorMessage(query.error)}
          </AppAlert>
        ) : query.data?.length ? (
          query.data.map((entry) => (
            <div key={entry.id} className="procurement-history-item">
              <time>{formatDate(entry.createdAt, true)}</time>
              <div>
                <strong>{entry.actorName}</strong>
                <p>
                  <StatusBadge status={entry.oldStatus ?? "DRAFT"} /> <span>→</span>{" "}
                  <StatusBadge status={entry.newStatus} />
                </p>
                {entry.comment && <blockquote>{entry.comment}</blockquote>}
              </div>
            </div>
          ))
        ) : (
          <div className="procurement-empty">Изменений статуса ещё не было.</div>
        )}
      </div>
    </AppModal>
  );
}
