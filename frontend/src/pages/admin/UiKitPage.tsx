import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Info,
  MoreHorizontal,
  Package,
  Pencil,
  Save,
  Send,
  Settings2,
  Trash2,
} from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { z } from "zod";
import { AdminPage } from "@/layouts/AdminPage";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton, AppSplitButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import {
  AppChart,
  AppChartLegend,
  AppChartTooltip,
  appChartColors,
  useAppChartLegend,
} from "@/shared/ui/AppChart";
import {
  AppCheckbox,
  AppFileUpload,
  AppRadioGroup,
  AppSwitch,
  AppTabs,
} from "@/shared/ui/AppControls";
import {
  AppDatePicker,
  AppDateTimePicker,
  AppDateRangePicker,
  type AppDateRange,
} from "@/shared/ui/AppDatePicker";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppContextMenu } from "@/shared/ui/AppContextMenu";
import { AppFloatingWindow } from "@/shared/ui/AppFloatingWindow";
import {
  AppInput,
  AppMoneyInput,
  AppNumberInput,
  AppPhoneInput,
  AppSearchInput,
  AppSelect,
  AppTextarea,
  type AppSelectOption,
} from "@/shared/ui/AppField";
import { AppAlert, AppModal, AppSkeleton, AppTooltip } from "@/shared/ui/AppFeedback";
import { AppImageUpload, type AppImageUploadItem } from "@/shared/ui/AppImageUpload";
import { AppNotificationMenu } from "@/shared/ui/AppNotificationMenu";
import { AppRichTextEditor } from "@/shared/ui/AppRichTextEditor";
import { AppTable } from "@/shared/ui/AppTable";
import {
  AppTreeDataTable,
  type AppTreeDataTableColumn,
  type AppTreeTableBulkAction,
} from "@/shared/ui/AppTreeDataTable";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { Category, Product } from "@/shared/types/models";
import { ActiveFilterTags } from "@/pages/public/ActiveFilterTags";
import { CatalogFilters } from "@/pages/public/CatalogFilters";
import { CatalogToolbar } from "@/pages/public/CatalogToolbar";
import { CategoryCard } from "@/pages/public/CategoryCard";
import { Pagination } from "@/pages/public/Pagination";
import { ProductCard } from "@/pages/public/ProductCard";
import { ProductGrid } from "@/pages/public/ProductGrid";
import { PromoCategoryCard } from "@/pages/public/PromoCategoryCard";
import { StoreEmptyState } from "@/pages/public/StoreEmptyState";
import { StoreSearch } from "@/pages/public/StoreSearch";
import { countProductsByCategory } from "@/pages/public/store-utils";
import "./UiKitPage.css";

const categoryOptions: AppSelectOption[] = [
  { value: "boilers", label: "Котлы отопления" },
  { value: "radiators", label: "Радиаторы" },
  { value: "pumps", label: "Насосное оборудование" },
  { value: "pipes", label: "Трубы и фитинги" },
  { value: "automation", label: "Автоматика" },
  { value: "service", label: "Сервисные услуги", disabled: true },
];

const formSchema = z.object({
  name: z.string().min(3, "Введите не менее 3 символов"),
  email: z.string().email("Введите корректный email"),
  phone: z.string().min(18, "Введите полный номер телефона"),
  category: z.string().min(1, "Выберите категорию"),
  agreed: z.boolean().refine((value) => value, "Необходимо подтверждение"),
});

type FormValues = z.infer<typeof formSchema>;

type AnalyticsPeriod = "7d" | "30d" | "12m";

const analyticsByPeriod: Record<
  AnalyticsPeriod,
  { label: string; revenue: number; orders: number }[]
> = {
  "7d": [
    { label: "Пн", revenue: 480, orders: 18 },
    { label: "Вт", revenue: 620, orders: 24 },
    { label: "Ср", revenue: 570, orders: 21 },
    { label: "Чт", revenue: 790, orders: 31 },
    { label: "Пт", revenue: 910, orders: 37 },
    { label: "Сб", revenue: 740, orders: 28 },
    { label: "Вс", revenue: 860, orders: 34 },
  ],
  "30d": [
    { label: "1–3", revenue: 1550, orders: 61 },
    { label: "4–6", revenue: 1840, orders: 72 },
    { label: "7–9", revenue: 1720, orders: 68 },
    { label: "10–12", revenue: 2290, orders: 89 },
    { label: "13–15", revenue: 2460, orders: 94 },
    { label: "16–18", revenue: 2180, orders: 84 },
    { label: "19–21", revenue: 2670, orders: 103 },
    { label: "22–24", revenue: 2810, orders: 111 },
    { label: "25–27", revenue: 2590, orders: 98 },
    { label: "28–30", revenue: 3040, orders: 119 },
  ],
  "12m": [
    { label: "Июл", revenue: 6800, orders: 264 },
    { label: "Авг", revenue: 7200, orders: 281 },
    { label: "Сен", revenue: 7950, orders: 309 },
    { label: "Окт", revenue: 9100, orders: 347 },
    { label: "Ноя", revenue: 10400, orders: 392 },
    { label: "Дек", revenue: 12100, orders: 451 },
    { label: "Янв", revenue: 8800, orders: 338 },
    { label: "Фев", revenue: 9400, orders: 361 },
    { label: "Мар", revenue: 11200, orders: 426 },
    { label: "Апр", revenue: 11900, orders: 448 },
    { label: "Май", revenue: 12800, orders: 476 },
    { label: "Июн", revenue: 13700, orders: 508 },
  ],
};

const categorySales = [
  { category: "Котлы", sales: 148 },
  { category: "Радиаторы", sales: 126 },
  { category: "Насосы", sales: 98 },
  { category: "Фитинги", sales: 82 },
  { category: "Автоматика", sales: 64 },
];

const channelSales = [
  { month: "Янв", retail: 2400, wholesale: 1800, partners: 900 },
  { month: "Фев", retail: 2700, wholesale: 1950, partners: 1100 },
  { month: "Мар", retail: 3100, wholesale: 2240, partners: 1280 },
  { month: "Апр", retail: 2950, wholesale: 2480, partners: 1390 },
  { month: "Май", retail: 3480, wholesale: 2710, partners: 1520 },
  { month: "Июн", retail: 3820, wholesale: 2960, partners: 1710 },
];

const categoryShare = [
  { key: "boilers", name: "Котлы", value: 34, color: appChartColors.orange },
  { key: "radiators", name: "Радиаторы", value: 25, color: appChartColors.blue },
  { key: "pumps", name: "Насосы", value: 18, color: appChartColors.green },
  { key: "fittings", name: "Фитинги", value: 14, color: appChartColors.violet },
  { key: "automation", name: "Автоматика", value: 9, color: appChartColors.cyan },
];

const stockMargin = [
  { name: "Котлы", stock: 22, margin: 31, revenue: 5400 },
  { name: "Радиаторы", stock: 48, margin: 24, revenue: 3900 },
  { name: "Насосы", stock: 34, margin: 28, revenue: 3200 },
  { name: "Фитинги", stock: 86, margin: 18, revenue: 2100 },
  { name: "Автоматика", stock: 57, margin: 35, revenue: 2800 },
  { name: "Бойлеры", stock: 18, margin: 27, revenue: 3600 },
];

const businessHealth = [
  { metric: "Продажи", current: 88, target: 92 },
  { metric: "Маржа", current: 76, target: 85 },
  { metric: "Остатки", current: 69, target: 78 },
  { metric: "Конверсия", current: 82, target: 88 },
  { metric: "Доставка", current: 91, target: 95 },
  { metric: "Повторные", current: 64, target: 75 },
];

const funnelPerformance = [
  { stage: "Янв", revenue: 4200, conversion: 2.8 },
  { stage: "Фев", revenue: 4750, conversion: 3.1 },
  { stage: "Мар", revenue: 5620, conversion: 3.6 },
  { stage: "Апр", revenue: 6110, conversion: 3.4 },
  { stage: "Май", revenue: 6890, conversion: 4.1 },
  { stage: "Июн", revenue: 7520, conversion: 4.5 },
];

const moneyTooltipFormatter = (value: unknown, name: string) =>
  [`${new Intl.NumberFormat("ru-KZ").format(Number(value))} тыс. ₸`, name] as [string, string];

type DemoProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: "active" | "draft" | "archived";
  updatedAt: string;
};

const demoCategories = ["Котлы", "Радиаторы", "Насосы", "Автоматика", "Фитинги"];
const demoNames = [
  "Котел газовый Ariston",
  "Радиатор Royal Thermo",
  "Насос циркуляционный Grundfos",
  "Термостат комнатный",
  "Комплект фитингов",
  "Бойлер косвенного нагрева",
];

const demoProducts: DemoProduct[] = Array.from({ length: 36 }, (_, index) => ({
  id: String(index + 1),
  sku: `ACT-${String(index + 101).padStart(4, "0")}`,
  name: `${demoNames[index % demoNames.length]} ${index + 1}`,
  category: demoCategories[index % demoCategories.length],
  price: 18500 + index * 7250,
  stock: (index * 7) % 48,
  status: index % 9 === 0 ? "archived" : index % 4 === 0 ? "draft" : "active",
  updatedAt: `${String((index % 27) + 1).padStart(2, "0")}.06.2026`,
}));

const storeUiCategories: Category[] = [
  {
    id: 1,
    parentId: null,
    nameRu: "Котлы",
    nameKk: "Қазандықтар",
    slug: "kotly",
    descriptionRu: "Напольные и настенные решения для отопления.",
    descriptionKk: "Жылытуға арналған едендік және қабырғалық шешімдер.",
    imageFilePath: "",
    sortOrder: 1,
    active: true,
  },
  {
    id: 2,
    parentId: null,
    nameRu: "Насосы",
    nameKk: "Сорғылар",
    slug: "nasosy",
    descriptionRu: "Циркуляционные насосы и инженерные узлы.",
    descriptionKk: "Циркуляциялық сорғылар және инженерлік тораптар.",
    imageFilePath: "",
    sortOrder: 2,
    active: true,
  },
  {
    id: 3,
    parentId: null,
    nameRu: "Радиаторы",
    nameKk: "Радиаторлар",
    slug: "radiatory",
    descriptionRu: "Компактные и панельные радиаторы.",
    descriptionKk: "Ықшам және панельді радиаторлар.",
    imageFilePath: "",
    sortOrder: 3,
    active: true,
  },
];

const storeUiProducts: Product[] = [
  {
    id: 101,
    sku: "ACT-1001",
    nameRu: "Газовый котёл Baxi Eco Nova 24F",
    nameKk: "Baxi Eco Nova 24F газ қазандығы",
    price: 72900,
    wholesalePrice: 84500,
    categoryId: 1,
    categoryNameRu: "Котлы",
    active: true,
    shortDescriptionRu: "Двухконтурный котёл с закрытой камерой сгорания.",
    descriptionRu: "Подходит для квартир и частных домов.",
    images: [],
  },
  {
    id: 102,
    sku: "ACT-1002",
    nameRu: "Циркуляционный насос Grundfos UPS 25-40",
    nameKk: "Grundfos UPS 25-40 циркуляциялық сорғы",
    price: 12400,
    categoryId: 2,
    categoryNameRu: "Насосы",
    active: false,
    shortDescriptionRu: "Надёжный насос для систем отопления.",
    descriptionRu: "Универсальная модель для бытовых систем.",
    images: [],
  },
];

type DemoTreeNode = {
  id: number;
  name: string;
  slug: string;
  kind: "catalog" | "group" | "leaf";
  active: boolean;
  children?: DemoTreeNode[];
};

const demoTreeData: DemoTreeNode[] = [
  {
    id: 1,
    name: "Отопление",
    slug: "otoplenie",
    kind: "catalog",
    active: true,
    children: [
      {
        id: 11,
        name: "Котлы",
        slug: "kotly",
        kind: "group",
        active: true,
        children: [
          {
            id: 111,
            name: "Газовые котлы",
            slug: "gazovye-kotly",
            kind: "leaf",
            active: true,
          },
          {
            id: 112,
            name: "Электрические котлы",
            slug: "elektricheskie-kotly",
            kind: "leaf",
            active: false,
          },
          {
            id: 113,
            name: "Твердотопливные котлы",
            slug: "tverdotoplivnye-kotly",
            kind: "leaf",
            active: true,
          },
        ],
      },
      {
        id: 12,
        name: "Радиаторы",
        slug: "radiatory",
        kind: "group",
        active: true,
        children: [
          {
            id: 121,
            name: "Алюминиевые радиаторы",
            slug: "alyuminievye-radiatory",
            kind: "leaf",
            active: true,
          },
          {
            id: 122,
            name: "Биметаллические радиаторы",
            slug: "bimetallicheskie-radiatory",
            kind: "leaf",
            active: true,
          },
        ],
      },
    ],
  },
  {
    id: 2,
    name: "Водоснабжение",
    slug: "vodosnabzhenie",
    kind: "catalog",
    active: true,
    children: [
      {
        id: 21,
        name: "Насосы",
        slug: "nasosy",
        kind: "group",
        active: true,
        children: [
          {
            id: 211,
            name: "Циркуляционные насосы",
            slug: "tsirkulyatsionnye-nasosy",
            kind: "leaf",
            active: true,
          },
          {
            id: 212,
            name: "Дренажные насосы",
            slug: "drenazhnye-nasosy",
            kind: "leaf",
            active: false,
          },
        ],
      },
      {
        id: 22,
        name: "Трубы",
        slug: "truby",
        kind: "group",
        active: true,
        children: [
          {
            id: 221,
            name: "Полипропиленовые трубы",
            slug: "polipropilenovye-truby",
            kind: "leaf",
            active: true,
          },
        ],
      },
    ],
  },
  {
    id: 3,
    name: "Автоматика",
    slug: "avtomatika",
    kind: "catalog",
    active: false,
    children: [
      {
        id: 31,
        name: "Термостаты",
        slug: "termostaty",
        kind: "group",
        active: true,
        children: [
          {
            id: 311,
            name: "Комнатные термостаты",
            slug: "komnatnye-termostaty",
            kind: "leaf",
            active: true,
          },
          {
            id: 312,
            name: "Программируемые термостаты",
            slug: "programmiruemye-termostaty",
            kind: "leaf",
            active: true,
          },
        ],
      },
      {
        id: 32,
        name: "Контроллеры",
        slug: "kontrollery",
        kind: "group",
        active: false,
        children: [
          {
            id: 321,
            name: "Контроллеры котлов",
            slug: "kontrollery-kotlov",
            kind: "leaf",
            active: true,
          },
        ],
      },
    ],
  },
];

const demoTreeColumns: AppTreeDataTableColumn<DemoTreeNode>[] = [
  {
    id: "name",
    header: "Название",
    accessor: "name",
    sortable: true,
    cell: (row) => <strong>{row.name}</strong>,
  },
  {
    id: "slug",
    header: "Slug",
    accessor: "slug",
    sortable: true,
    cell: (row) => <code>{row.slug}</code>,
  },
  {
    id: "kind",
    header: "Тип",
    accessor: "kind",
    sortable: true,
    filterable: true,
    filterOptions: [
      { value: "catalog", label: "Каталог" },
      { value: "group", label: "Группа" },
      { value: "leaf", label: "Элемент" },
    ],
    cell: (row) => (
      <AppBadge tone={row.kind === "catalog" ? "blue" : row.kind === "group" ? "orange" : "slate"}>
        {row.kind === "catalog" ? "Каталог" : row.kind === "group" ? "Группа" : "Элемент"}
      </AppBadge>
    ),
  },
  {
    id: "status",
    header: "Статус",
    value: (row) => (row.active ? "active" : "hidden"),
    filterable: true,
    filterOptions: [
      { value: "active", label: "Активные" },
      { value: "hidden", label: "Скрытые" },
    ],
    cell: (row) => (
      <AppBadge tone={row.active ? "green" : "slate"}>{row.active ? "Активна" : "Скрыта"}</AppBadge>
    ),
  },
];

const demoTreeBulkActions: AppTreeTableBulkAction<DemoTreeNode>[] = [
  {
    label: "В архив",
    icon: <Archive size={15} />,
    onSelect: (rows) => appToast.info(`В архив отправлено: ${rows.length}`),
  },
  {
    label: "Удалить",
    icon: <Trash2 size={15} />,
    tone: "danger",
    onSelect: (rows) => appToast.error(`Выбрано для удаления: ${rows.length}`),
  },
];

const demoProductColumns: AppDataTableColumn<DemoProduct>[] = [
  {
    id: "sku",
    header: "Артикул",
    accessor: "sku",
    sortable: true,
    width: 130,
    cell: (row) => <code>{row.sku}</code>,
  },
  {
    id: "name",
    header: "Название",
    accessor: "name",
    sortable: true,
    cell: (row) => <strong>{row.name}</strong>,
  },
  {
    id: "category",
    header: "Категория",
    accessor: "category",
    sortable: true,
    filterable: true,
    filterOptions: demoCategories.map((category) => ({ value: category, label: category })),
  },
  {
    id: "price",
    header: "Цена",
    accessor: "price",
    sortable: true,
    align: "right",
    cell: (row) => `${new Intl.NumberFormat("ru-KZ").format(row.price)} ₸`,
  },
  {
    id: "stock",
    header: "Остаток",
    accessor: "stock",
    sortable: true,
    align: "center",
    cell: (row) => (
      <AppBadge tone={row.stock > 10 ? "green" : row.stock > 0 ? "orange" : "red"}>
        {row.stock} шт.
      </AppBadge>
    ),
  },
  {
    id: "status",
    header: "Статус",
    accessor: "status",
    filterable: true,
    filterOptions: [
      { value: "active", label: "Активные" },
      { value: "draft", label: "Черновики" },
      { value: "archived", label: "Архив" },
    ],
    cell: (row) => (
      <AppBadge
        tone={row.status === "active" ? "green" : row.status === "draft" ? "orange" : "slate"}
      >
        {row.status === "active" ? "Активен" : row.status === "draft" ? "Черновик" : "Архив"}
      </AppBadge>
    ),
  },
  {
    id: "updatedAt",
    header: "Обновлено",
    accessor: "updatedAt",
    sortable: true,
    initialHidden: true,
  },
  {
    id: "actions",
    header: "",
    hideable: false,
    width: 56,
    align: "right",
    cell: (row) => (
      <AppActionMenu
        label={`Действия: ${row.name}`}
        actions={[
          {
            label: "Открыть",
            icon: <Eye size={16} />,
            onSelect: () => appToast.info(`Открыт товар ${row.sku}`),
          },
          {
            label: "Редактировать",
            icon: <Pencil size={16} />,
            onSelect: () => appToast.info(`Редактирование ${row.sku}`),
          },
          {
            label: "Удалить",
            icon: <Trash2 size={16} />,
            onSelect: () => appToast.error(`Демонстрационное удаление ${row.sku}`),
          },
        ]}
      />
    ),
  },
];

function UiKitSection({
  index,
  title,
  description,
  children,
}: {
  index: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ui-kit-section">
      <header className="ui-kit-section__header">
        <span>{index}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="ui-kit-section__content">{children}</div>
    </section>
  );
}

export function UiKitPage() {
  const [money, setMoney] = useState<number | null>(485000);
  const [phone, setPhone] = useState("+7");
  const [date, setDate] = useState<Date>();
  const [dateTime, setDateTime] = useState<Date>();
  const [dateTimeValid, setDateTimeValid] = useState(false);
  const [range, setRange] = useState<AppDateRange>();
  const [single, setSingle] = useState("boilers");
  const [searchable, setSearchable] = useState("");
  const [multiple, setMultiple] = useState<string[]>(categoryOptions.map((option) => option.value));
  const [multipleSearch, setMultipleSearch] = useState<string[]>([]);
  const [loadingIcon, setLoadingIcon] = useState(false);
  const [loadingText, setLoadingText] = useState(false);
  const [loadingOnly, setLoadingOnly] = useState(false);
  const [loadingSplit, setLoadingSplit] = useState(false);
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [radio, setRadio] = useState("retail");
  const [files, setFiles] = useState<File[]>([]);
  const [imageDemoFiles, setImageDemoFiles] = useState<File[]>([]);
  const [activeDemoTab, setActiveDemoTab] = useState("catalog");
  const [paginationPreviewPage, setPaginationPreviewPage] = useState(2);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>("30d");
  const [infiniteDemoCount, setInfiniteDemoCount] = useState(14);
  const [infiniteDemoLoading, setInfiniteDemoLoading] = useState(false);
  const [expandedDemoProductId, setExpandedDemoProductId] = useState<string | null>(null);
  const [collapsedDemoCategories, setCollapsedDemoCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const [contextMenuDemo, setContextMenuDemo] = useState<{ x: number; y: number } | null>(null);
  const [floatingWindowDemoOpen, setFloatingWindowDemoOpen] = useState(false);
  const [richText, setRichText] = useState("<p>Правила <strong>установки цен</strong>.</p>");
  const trendLegend = useAppChartLegend();
  const categoryLegend = useAppChartLegend();
  const channelLegend = useAppChartLegend();
  const shareLegend = useAppChartLegend();
  const scatterLegend = useAppChartLegend();
  const radarLegend = useAppChartLegend();
  const composedLegend = useAppChartLegend();
  const imageDemoPreviews = useMemo(
    () =>
      imageDemoFiles.map((file, index) => ({
        id: `demo-${file.name}-${file.lastModified}`,
        src: URL.createObjectURL(file),
        name: file.name,
        main: index === 0,
        pending: true,
      })),
    [imageDemoFiles],
  );
  const imageDemoItems: AppImageUploadItem[] = [
    {
      id: "existing-demo",
      src: "/favicon.svg?v=gastroflow-1",
      name: "Демонстрационное изображение",
      main: imageDemoFiles.length === 0,
    },
    ...imageDemoPreviews,
  ];

  function toggleDemoCategory(category: string) {
    setCollapsedDemoCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  useEffect(
    () => () => imageDemoPreviews.forEach((preview) => URL.revokeObjectURL(preview.src)),
    [imageDemoPreviews],
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "+7",
      category: "",
      agreed: false,
    },
  });

  async function simulate(setter: React.Dispatch<React.SetStateAction<boolean>>, message: string) {
    setter(true);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    setter(false);
    appToast.success(message);
  }

  async function loadMoreDemoProducts() {
    if (infiniteDemoLoading || infiniteDemoCount >= demoProducts.length) return;
    setInfiniteDemoLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    setInfiniteDemoCount((current) => Math.min(current + 8, demoProducts.length));
    setInfiniteDemoLoading(false);
  }

  async function submitForm(values: FormValues) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    appToast.success(`Форма сохранена: ${values.name}`);
    reset();
  }

  return (
    <AdminPage
      eyebrow="Внутренний дизайн-системный раздел"
      title="UI-kit компонентов"
      actions={<AppBadge tone="orange">shadcn/ui + App*</AppBadge>}
    >
      <div className="ui-kit-intro">
        <div>
          <strong>Живой каталог интерфейса</strong>
          <p>
            Все элементы ниже интерактивны и предназначены для повторного использования в формах
            CRM.
          </p>
        </div>
        <code>/admin/ui-kit</code>
      </div>

      <UiKitSection
        index="01"
        title="Поля и состояния"
        description="Базовые значения, подсказки, ошибки, префиксы и заблокированные состояния."
      >
        <div className="ui-kit-grid">
          <AppInput label="Текстовое поле" placeholder="Введите название" hint="До 120 символов" />
          <AppInput label="Заполненное поле" defaultValue="Котел газовый Ariston" />
          <AppNumberInput label="Количество" defaultValue={12} min={0} step={1} suffix="шт." />
          <AppMoneyInput
            label="Цена"
            value={money}
            onValueChange={setMoney}
            hint="Форматируется в тенге"
          />
          <AppPhoneInput label="Телефон" value={phone} onValueChange={setPhone} />
          <AppSearchInput label="Поиск" placeholder="Артикул или название" />
          <AppInput
            label="Пароль"
            type="password"
            defaultValue="password123"
            hint="Минимум 8 символов"
          />
          <AppInput
            label="Поле с ошибкой"
            defaultValue="Некорректное значение"
            error="Значение уже используется"
          />
          <AppInput label="Неактивное поле" value="Редактирование запрещено" disabled />
          <AppTextarea
            label="Описание"
            placeholder="Технические характеристики товара"
            hint="Двойной клик по уголку расширяет поле до высоты текста"
          />
          <AppRichTextEditor
            label="Текстовый редактор"
            value={richText}
            onValueChange={setRichText}
            placeholder="Введите форматированный текст"
          />
        </div>
      </UiKitSection>
      <UiKitSection
        index="02"
        title="Дата и период"
        description="Календарь с русской локалью, очисткой значения и выбором диапазона."
      >
        <div className="ui-kit-grid ui-kit-grid--dates">
          <AppDatePicker label="Дата поставки" value={date} onValueChange={setDate} />
          <AppDateTimePicker
            label="Дата и время документа"
            required
            value={dateTime}
            onValueChange={setDateTime}
            onValidityChange={setDateTimeValid}
            hint={
              dateTimeValid ? "Дата и время заполнены" : "Неверная дата блокирует отправку формы"
            }
          />
          <AppDateRangePicker
            label="Период отчета"
            value={range}
            onValueChange={setRange}
            hint="Можно выбрать начало и конец периода"
          />
          <AppDatePicker
            label="Неактивная дата"
            value={new Date(2026, 5, 18)}
            onValueChange={() => undefined}
            disabled
          />
        </div>
      </UiKitSection>

      <UiKitSection
        index="03"
        title="Выпадающие списки"
        description="Одиночный и множественный выбор с поиском, очисткой и disabled-опциями."
      >
        <div className="ui-kit-grid">
          <AppSelect
            label="Одиночный выбор"
            options={categoryOptions}
            value={single}
            onValueChange={(value) => setSingle(value as string)}
          />
          <AppSelect
            label="Одиночный выбор с поиском"
            options={categoryOptions.map((option) =>
              option.value === "boilers" ? { ...option, keywords: ["отопление"] } : option,
            )}
            hint="Введите «отопление»: поиск учитывает keywords, сохраняя название варианта."
            value={searchable}
            searchable
            onValueChange={(value) => setSearchable(value as string)}
          />
          <AppSelect
            label="Множественный выбор"
            options={categoryOptions}
            value={multiple}
            multiple
            multipleValueDisplay="count"
            multipleValueLabel={(selected, options) =>
              selected.length === options.length ? "Все разделы" : `Выбрано: ${selected.length}`
            }
            showSelectedTags={false}
            onValueChange={(value) => setMultiple(value as string[])}
          />
          <AppSelect
            label="Множественный выбор с поиском"
            options={categoryOptions}
            value={multipleSearch}
            multiple
            searchable
            onValueChange={(value) => setMultipleSearch(value as string[])}
          />
        </div>
      </UiKitSection>

      <UiKitSection
        index="04"
        title="Кнопки и действия"
        description="Основные варианты, loading-состояния и составная кнопка с меню."
      >
        <div className="ui-kit-actions">
          <AppButton>
            <Save size={18} />
            Primary
          </AppButton>
          <AppButton variant="secondary">Secondary</AppButton>
          <AppButton asChild variant="secondary">
            <a href="#ui-kit-button-link">Ссылка-кнопка</a>
          </AppButton>
          <AppButton variant="neutral">Нейтральная</AppButton>
          <AppButton variant="danger">
            <Trash2 size={18} />
            Удалить
          </AppButton>
          <AppButton disabled>Неактивная</AppButton>
          <AppButton
            loading={loadingIcon}
            aria-label="Сохранить"
            onClick={() => simulate(setLoadingIcon, "Операция завершена")}
          >
            <Download size={18} />
          </AppButton>
          <AppButton
            loading={loadingText}
            loadingText="Сохранение..."
            onClick={() => simulate(setLoadingText, "Изменения сохранены")}
          >
            Сохранить
          </AppButton>
          <AppButton
            loading={loadingOnly}
            loadingMode="spinner-only"
            onClick={() => simulate(setLoadingOnly, "Обработка завершена")}
          >
            Обработать
          </AppButton>
          <AppButton
            type="button"
            variant="secondary"
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenuDemo({ x: event.clientX, y: event.clientY });
            }}
          >
            ПКМ: вложенное меню
          </AppButton>
          <AppSplitButton
            loading={loadingSplit}
            loadingText="Сохраняем…"
            onClick={() => simulate(setLoadingSplit, "Документ сохранен")}
            actions={[
              {
                label: "Сохранить копию",
                icon: <Copy size={17} />,
                onSelect: () => appToast.info("Создана копия"),
              },
              {
                label: "Отправить",
                icon: <Send size={17} />,
                onSelect: () => appToast.success("Документ отправлен"),
              },
              {
                label: "В архив",
                icon: <Archive size={17} />,
                onSelect: () => appToast.info("Перемещено в архив"),
              },
            ]}
          >
            Сохранить
          </AppSplitButton>
          <AppTooltip content="Дополнительные настройки">
            <AppButton variant="ghost" aria-label="Дополнительные настройки">
              <MoreHorizontal size={20} />
            </AppButton>
          </AppTooltip>
        </div>
      </UiKitSection>
      <AppContextMenu
        open={Boolean(contextMenuDemo)}
        x={contextMenuDemo?.x ?? 0}
        y={contextMenuDemo?.y ?? 0}
        label="Пример вложенного меню"
        actions={[
          {
            label: "Быстрое действие",
            onSelect: () => appToast.success("Действие выполнено"),
          },
          {
            label: "Выбрать источник",
            separatorBefore: true,
            onSelect: () => undefined,
            children: [
              {
                label: "Чистая приходная",
                onSelect: () => appToast.info("Выбрана чистая приходная"),
              },
              {
                label: "Цена из карточки",
                onSelect: () => undefined,
                children: [
                  {
                    label: "Розничная",
                    onSelect: () => appToast.info("Выбрана розничная цена"),
                  },
                ],
              },
            ],
          },
        ]}
        onOpenChange={(open) => {
          if (!open) setContextMenuDemo(null);
        }}
      />

      <UiKitSection
        index="05"
        title="Выбор и загрузка"
        description="Checkbox, switch, radio group, tabs и поле загрузки файлов."
      >
        <div className="ui-kit-grid">
          <div className="ui-kit-stack">
            <AppCheckbox
              label="Публиковать товар"
              description="Товар будет виден в интернет-магазине"
              checked={checked}
              onCheckedChange={setChecked}
            />
            <AppSwitch
              label="Автоматическая синхронизация"
              description="Получать изменения из 1С"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
          <AppRadioGroup
            label="Тип цены"
            value={radio}
            onValueChange={setRadio}
            options={[
              { value: "retail", label: "Розничная", description: "Основная цена каталога" },
              { value: "wholesale", label: "Оптовая", description: "Для партнеров компании" },
            ]}
          />
          <div>
            <AppFileUpload
              accept="image/*,.xlsx"
              multiple
              onChange={(nextFiles) => setFiles(nextFiles)}
            />
            {files.length > 0 && <p className="ui-kit-file-note">Выбрано файлов: {files.length}</p>}
          </div>
          <AppImageUpload
            items={imageDemoItems}
            maxFiles={4}
            onFilesSelected={(nextFiles) =>
              setImageDemoFiles((current) => [
                ...current,
                ...nextFiles.slice(0, 3 - current.length),
              ])
            }
            onRemove={(item) => {
              if (item.pending) {
                setImageDemoFiles((current) =>
                  current.filter((file) => `demo-${file.name}-${file.lastModified}` !== item.id),
                );
              }
            }}
            onSetMain={() =>
              appToast.info("В продуктовой форме главное фото сохраняется через API")
            }
          />
          <AppTabs
            defaultValue="ru"
            items={[
              { value: "ru", label: "Русский", content: <AppInput defaultValue="Радиатор" /> },
              { value: "kk", label: "Қазақша", content: <AppInput defaultValue="Радиатор" /> },
            ]}
          />
        </div>
      </UiKitSection>

      <UiKitSection
        index="06"
        title="Карточки и обратная связь"
        description="Контейнеры, статусы, modal, toast и skeleton для загрузки."
      >
        <div className="ui-kit-grid">
          <AppCard
            title="Карточка товара"
            description="Структурированный контейнер с действиями и footer."
            actions={<AppBadge tone="green">Активен</AppBadge>}
            footer={
              <div className="ui-kit-actions">
                <AppButton variant="secondary">Отмена</AppButton>
                <AppButton>Сохранить</AppButton>
              </div>
            }
          >
            <p className="muted">Внутри карточки размещается связанный набор данных.</p>
          </AppCard>
          <div className="ui-kit-stack">
            <AppAlert title="Информация">Каталог синхронизирован 5 минут назад.</AppAlert>
            <AppAlert title="Успешно" tone="success">
              124 товара обновлены.
            </AppAlert>
            <AppAlert title="Требуется внимание" tone="warning">
              У 8 товаров отсутствуют изображения.
            </AppAlert>
            <AppAlert title="Ошибка импорта" tone="danger">
              Проверьте формат исходного файла.
            </AppAlert>
          </div>
          <div className="ui-kit-stack">
            <AppModal
              title="Подтверждение действия"
              description="Проверьте данные перед продолжением."
              trigger={<AppButton variant="secondary">Открыть modal</AppButton>}
            >
              <AppAlert title="Демонстрационный диалог" tone="info">
                Фокус удерживается внутри окна, закрытие доступно по Escape.
              </AppAlert>
            </AppModal>
            <AppButton onClick={() => appToast.success("Настройки сохранены")}>
              Показать toast
            </AppButton>
            <AppButton
              variant="secondary"
              onClick={() =>
                appToast.info("Позиция удалена", {
                  action: {
                    label: "Отменить",
                    onClick: () => appToast.success("Позиция восстановлена"),
                  },
                })
              }
            >
              Уведомление с отменой
            </AppButton>
            <AppButton variant="secondary" onClick={() => setFloatingWindowDemoOpen(true)}>
              Открыть плавающее окно
            </AppButton>
          </div>
          <AppSkeleton />
        </div>
        <div className="ui-kit-metric-showcase">
          <MetricCard
            icon={<Package size={22} />}
            label="Стандартная метрика"
            value="1 248"
            trend="+8%"
          />
          <MetricCard
            icon={<Package size={18} />}
            label="Компактная метрика"
            value="1 248"
            trend="+8%"
            size="compact"
            accent
            actions={<AppButton variant="secondary">Подробнее</AppButton>}
          />
        </div>
        <DataPanel title="Компактная панель с таблицей" size="compact">
          <AppTable
            size="compact"
            headers={["ID", "Название", "Статус"]}
            rows={[
              [
                "#1697",
                "Реле температуры и влажности SONOFF TH 16 WiFi",
                <AppBadge tone="green">Активен</AppBadge>,
              ],
              [
                "#1698",
                "Модуль с двумя реле для управления электроприбором",
                <AppBadge>Черновик</AppBadge>,
              ],
            ]}
          />
        </DataPanel>
        <div className="ui-kit-actions">
          <AppNotificationMenu
            unreadCount={2}
            items={[
              {
                id: 1,
                type: "NEW_ORDER",
                title: "Новый заказ",
                message: "Александр оформил заказ на сумму 48 500 ₸",
                orderId: "019fc602-8a40-7e30-a9ee-afaa17413880",
                displayCode: "20260803154",
                actionUrl: "/admin/orders/019fc602-8a40-7e30-a9ee-afaa17413880",
                read: false,
                createdAt: new Date().toISOString(),
              },
              {
                id: 2,
                type: "ORDER_STATUS_CHANGED",
                title: "Статус заказа изменён",
                message: "Новый статус: В работе",
                orderId: "019fc602-8a40-7e30-a9ee-afaa17413881",
                displayCode: "20260803149",
                actionUrl: "/orders/019fc602-8a40-7e30-a9ee-afaa17413881",
                read: false,
                createdAt: new Date(Date.now() - 3_600_000).toISOString(),
              },
            ]}
            onSelect={() => appToast.info("Открытие уведомления")}
            onMarkAllRead={() => appToast.success("Все уведомления прочитаны")}
            footer={
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => appToast.info("Настройки уведомлений")}
                style={{ width: "100%" }}
              >
                Настройки уведомлений
              </AppButton>
            }
          />
          <span className="muted">Центр уведомлений о заказах</span>
        </div>
      </UiKitSection>
      <AppFloatingWindow
        open={floatingWindowDemoOpen}
        title="Плавающее окно"
        onOpenChange={setFloatingWindowDemoOpen}
      >
        <p className="muted">
          Перетаскивайте окно за шапку и меняйте его размер за нижний правый угол.
        </p>
      </AppFloatingWindow>

      <UiKitSection
        index="07"
        title="Пример формы"
        description="React Hook Form + Zod, контролируемые поля, сообщения ошибок и отправка."
      >
        <form className="ui-kit-form" onSubmit={handleSubmit(submitForm)}>
          <AppInput
            label="Название компании"
            required
            placeholder="ТОО GastroFlow"
            error={errors.name?.message}
            {...register("name")}
          />
          <AppInput
            label="Email"
            type="email"
            required
            placeholder="manager@example.com"
            error={errors.email?.message}
            {...register("email")}
          />
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <AppPhoneInput
                label="Телефон"
                required
                value={field.value}
                onValueChange={field.onChange}
                error={errors.phone?.message}
              />
            )}
          />
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <AppSelect
                label="Категория"
                required
                searchable
                options={categoryOptions}
                value={field.value}
                onValueChange={(value) => field.onChange(value)}
                error={errors.category?.message}
              />
            )}
          />
          <Controller
            name="agreed"
            control={control}
            render={({ field }) => (
              <div>
                <AppCheckbox
                  label="Данные проверены"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                {errors.agreed && (
                  <small className="ui-kit-form-error">{errors.agreed.message}</small>
                )}
              </div>
            )}
          />
          <div className="ui-kit-form__actions">
            <AppButton type="button" variant="secondary" onClick={() => reset()}>
              Сбросить
            </AppButton>
            <AppButton type="submit" loading={isSubmitting} loadingText="Отправка...">
              <Check size={18} />
              Проверить и сохранить
            </AppButton>
          </div>
        </form>
      </UiKitSection>

      <UiKitSection
        index="08"
        title="Табы"
        description="Underline, segmented и карточный варианты с иконками, счетчиками и disabled-состоянием."
      >
        <div className="ui-kit-tabs-showcase">
          <AppCard
            title="Underline"
            description="Для крупных разделов и навигации внутри страницы."
          >
            <AppTabs
              value={activeDemoTab}
              onValueChange={setActiveDemoTab}
              variant="underline"
              items={[
                {
                  value: "catalog",
                  label: "Каталог",
                  icon: <Package size={16} />,
                  count: 36,
                  content: (
                    <AppAlert title="Каталог">Активная вкладка управляется внешним state.</AppAlert>
                  ),
                },
                {
                  value: "settings",
                  label: "Настройки",
                  icon: <Settings2 size={16} />,
                  content: (
                    <AppAlert title="Настройки">Содержимое проявляется мягкой анимацией.</AppAlert>
                  ),
                },
                {
                  value: "archive",
                  label: "Архив",
                  icon: <Archive size={16} />,
                  count: 4,
                  content: (
                    <AppAlert title="Архив">Счетчик не меняет высоту панели вкладок.</AppAlert>
                  ),
                },
                {
                  value: "disabled",
                  label: "Недоступно",
                  disabled: true,
                  content: null,
                },
              ]}
            />
          </AppCard>

          <AppCard
            title="Segmented"
            description="Для компактного переключения режимов представления."
          >
            <AppTabs
              defaultValue="all"
              variant="segmented"
              items={[
                {
                  value: "all",
                  label: "Все",
                  count: 36,
                  content: <p className="muted">Все записи каталога.</p>,
                },
                {
                  value: "active",
                  label: "Активные",
                  count: 28,
                  content: <p className="muted">Только опубликованные товары.</p>,
                },
                {
                  value: "draft",
                  label: "Черновики",
                  count: 4,
                  content: <p className="muted">Товары на редактировании.</p>,
                },
              ]}
            />
          </AppCard>

          <AppCard
            title="Card tabs"
            description="Для самостоятельных режимов или крупных сущностей."
          >
            <AppTabs
              defaultValue="products"
              variant="card"
              items={[
                {
                  value: "products",
                  label: "Товары",
                  icon: <Package size={17} />,
                  count: 36,
                  content: <p className="muted">Управление товарным каталогом.</p>,
                },
                {
                  value: "archive",
                  label: "Архив",
                  icon: <Archive size={17} />,
                  count: 4,
                  align: "end",
                  content: <p className="muted">Скрытые и архивные позиции.</p>,
                },
              ]}
            />
          </AppCard>
        </div>
      </UiKitSection>

      <UiKitSection
        index="09"
        title="Графики и аналитика"
        description="Адаптивные графики с общей палитрой, интерактивными легендами, tooltip и переключением периода."
      >
        <div className="ui-kit-chart-toolbar">
          <div>
            <strong>Демонстрационные данные</strong>
            <span>Нажмите на элемент легенды, чтобы скрыть или вернуть серию.</span>
          </div>
          <SegmentedControl
            ariaLabel="Период аналитики"
            items={[
              { value: "7d", label: "7 дней" },
              { value: "30d", label: "30 дней" },
              { value: "12m", label: "12 месяцев" },
            ]}
            value={analyticsPeriod}
            onValueChange={(value) => setAnalyticsPeriod(value as AnalyticsPeriod)}
          />
        </div>

        <div className="ui-kit-chart-grid">
          <AppCard
            className="ui-kit-chart-card"
            title="Динамика выручки и заказов"
            description="Area + line показывают масштаб и направление изменения показателей."
          >
            <AppChart
              title="Динамика выручки и заказов"
              description={`Данные за выбранный период: ${analyticsPeriod}`}
            >
              <ComposedChart
                data={analyticsByPeriod[analyticsPeriod]}
                margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="ui-kit-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={appChartColors.orange} stopOpacity={0.42} />
                    <stop offset="95%" stopColor={appChartColors.orange} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis yAxisId="money" tickLine={false} axisLine={false} width={44} />
                <YAxis
                  yAxisId="orders"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  width={34}
                />
                <AppChartTooltip
                  formatter={(value, name) =>
                    name === "Выручка"
                      ? moneyTooltipFormatter(value, name)
                      : [`${value} заказов`, name]
                  }
                />
                <AppChartLegend
                  items={[
                    { key: "revenue", label: "Выручка", color: appChartColors.orange },
                    { key: "orders", label: "Заказы", color: appChartColors.blue },
                  ]}
                  hiddenKeys={trendLegend.hiddenKeys}
                  onToggle={trendLegend.toggle}
                />
                <Area
                  yAxisId="money"
                  type="monotone"
                  dataKey="revenue"
                  name="Выручка"
                  stroke={appChartColors.orange}
                  fill="url(#ui-kit-revenue-fill)"
                  strokeWidth={2}
                  hide={trendLegend.isHidden("revenue")}
                />
                <Line
                  yAxisId="orders"
                  type="monotone"
                  dataKey="orders"
                  name="Заказы"
                  stroke={appChartColors.blue}
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5 }}
                  hide={trendLegend.isHidden("orders")}
                />
              </ComposedChart>
            </AppChart>
          </AppCard>

          <AppCard
            className="ui-kit-chart-card"
            title="Продажи по категориям"
            description="Обычная столбчатая диаграмма для сравнения дискретных значений."
          >
            <AppChart title="Продажи по категориям" description="Количество продаж по категориям">
              <BarChart
                data={categorySales}
                layout="vertical"
                margin={{ top: 12, right: 16, left: 10, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="4 4" horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="category"
                  tickLine={false}
                  axisLine={false}
                  width={82}
                />
                <AppChartTooltip formatter={(value, name) => [`${value} продаж`, name]} />
                <AppChartLegend
                  items={[{ key: "sales", label: "Продажи", color: appChartColors.blue }]}
                  hiddenKeys={categoryLegend.hiddenKeys}
                  onToggle={categoryLegend.toggle}
                />
                <Bar
                  dataKey="sales"
                  name="Продажи"
                  fill={appChartColors.blue}
                  radius={[0, 5, 5, 0]}
                  hide={categoryLegend.isHidden("sales")}
                />
              </BarChart>
            </AppChart>
          </AppCard>

          <AppCard
            className="ui-kit-chart-card"
            title="Каналы продаж"
            description="Stacked bar показывает общий итог и вклад каждого канала."
          >
            <AppChart title="Каналы продаж" description="Выручка по каналам продаж">
              <BarChart data={channelSales} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={44} />
                <AppChartTooltip formatter={moneyTooltipFormatter} />
                <AppChartLegend
                  items={[
                    { key: "retail", label: "Розница", color: appChartColors.orange },
                    { key: "wholesale", label: "Опт", color: appChartColors.blue },
                    { key: "partners", label: "Партнеры", color: appChartColors.green },
                  ]}
                  hiddenKeys={channelLegend.hiddenKeys}
                  onToggle={channelLegend.toggle}
                />
                <Bar
                  dataKey="retail"
                  name="Розница"
                  stackId="sales"
                  fill={appChartColors.orange}
                  hide={channelLegend.isHidden("retail")}
                />
                <Bar
                  dataKey="wholesale"
                  name="Опт"
                  stackId="sales"
                  fill={appChartColors.blue}
                  hide={channelLegend.isHidden("wholesale")}
                />
                <Bar
                  dataKey="partners"
                  name="Партнеры"
                  stackId="sales"
                  fill={appChartColors.green}
                  radius={[5, 5, 0, 0]}
                  hide={channelLegend.isHidden("partners")}
                />
              </BarChart>
            </AppChart>
          </AppCard>

          <AppCard
            className="ui-kit-chart-card"
            title="Структура выручки"
            description="Donut подходит для долей при небольшом числе категорий."
          >
            <AppChart title="Структура выручки" description="Доли категорий в общей выручке">
              <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                <AppChartTooltip formatter={(value, name) => [`${value}%`, name]} />
                <AppChartLegend
                  items={categoryShare.map((item) => ({
                    key: item.key,
                    label: item.name,
                    color: item.color,
                  }))}
                  hiddenKeys={shareLegend.hiddenKeys}
                  onToggle={shareLegend.toggle}
                />
                <Pie
                  data={categoryShare.filter((item) => !shareLegend.isHidden(item.key))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="54%"
                  outerRadius="78%"
                  paddingAngle={3}
                  stroke="var(--surface, #ffffff)"
                  strokeWidth={3}
                >
                  {categoryShare
                    .filter((item) => !shareLegend.isHidden(item.key))
                    .map((item) => (
                      <Cell key={item.key} fill={item.color} />
                    ))}
                </Pie>
              </PieChart>
            </AppChart>
          </AppCard>

          <AppCard
            className="ui-kit-chart-card"
            title="Остатки и маржинальность"
            description="Scatter выявляет взаимосвязи; размер точки отражает выручку."
          >
            <AppChart
              title="Остатки и маржинальность"
              description="Связь товарных остатков, маржи и выручки"
            >
              <ScatterChart margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="4 4" />
                <XAxis
                  type="number"
                  dataKey="stock"
                  name="Остаток"
                  unit=" шт."
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="number"
                  dataKey="margin"
                  name="Маржа"
                  unit="%"
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <ZAxis type="number" dataKey="revenue" range={[80, 480]} name="Выручка" />
                <AppChartTooltip />
                <AppChartLegend
                  items={[{ key: "categories", label: "Категории", color: appChartColors.violet }]}
                  hiddenKeys={scatterLegend.hiddenKeys}
                  onToggle={scatterLegend.toggle}
                />
                <Scatter
                  name="Категории"
                  data={stockMargin}
                  fill={appChartColors.violet}
                  hide={scatterLegend.isHidden("categories")}
                />
              </ScatterChart>
            </AppChart>
          </AppCard>

          <AppCard
            className="ui-kit-chart-card"
            title="Профиль бизнеса"
            description="Radar сравнивает несколько показателей относительно единой шкалы."
          >
            <AppChart title="Профиль бизнеса" description="Текущие показатели и целевые значения">
              <RadarChart data={businessHealth} outerRadius="70%">
                <PolarGrid />
                <PolarAngleAxis dataKey="metric" />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <AppChartTooltip formatter={(value, name) => [`${value}%`, name]} />
                <AppChartLegend
                  items={[
                    { key: "current", label: "Текущее", color: appChartColors.cyan },
                    { key: "target", label: "Цель", color: appChartColors.slate },
                  ]}
                  hiddenKeys={radarLegend.hiddenKeys}
                  onToggle={radarLegend.toggle}
                />
                <Radar
                  dataKey="current"
                  name="Текущее"
                  stroke={appChartColors.cyan}
                  fill={appChartColors.cyan}
                  fillOpacity={0.32}
                  strokeWidth={2}
                  hide={radarLegend.isHidden("current")}
                />
                <Radar
                  dataKey="target"
                  name="Цель"
                  stroke={appChartColors.slate}
                  fill={appChartColors.slate}
                  fillOpacity={0.08}
                  strokeDasharray="5 4"
                  hide={radarLegend.isHidden("target")}
                />
              </RadarChart>
            </AppChart>
          </AppCard>

          <AppCard
            className="ui-kit-chart-card ui-kit-chart-card--wide"
            title="Выручка и конверсия"
            description="Composed chart объединяет показатели с разными единицами измерения."
          >
            <AppChart
              title="Выручка и конверсия"
              description="Сравнение месячной выручки и конверсии"
              height={340}
            >
              <ComposedChart
                data={funnelPerformance}
                margin={{ top: 12, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="stage" tickLine={false} axisLine={false} />
                <YAxis yAxisId="revenue" tickLine={false} axisLine={false} width={48} />
                <YAxis
                  yAxisId="conversion"
                  orientation="right"
                  domain={[0, 6]}
                  tickFormatter={(value) => `${value}%`}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <AppChartTooltip
                  formatter={(value, name) =>
                    name === "Выручка" ? moneyTooltipFormatter(value, name) : [`${value}%`, name]
                  }
                />
                <AppChartLegend
                  items={[
                    { key: "revenue", label: "Выручка", color: appChartColors.green },
                    { key: "conversion", label: "Конверсия", color: appChartColors.rose },
                  ]}
                  hiddenKeys={composedLegend.hiddenKeys}
                  onToggle={composedLegend.toggle}
                />
                <Bar
                  yAxisId="revenue"
                  dataKey="revenue"
                  name="Выручка"
                  fill={appChartColors.green}
                  radius={[5, 5, 0, 0]}
                  hide={composedLegend.isHidden("revenue")}
                />
                <Line
                  yAxisId="conversion"
                  type="monotone"
                  dataKey="conversion"
                  name="Конверсия"
                  stroke={appChartColors.rose}
                  strokeWidth={3}
                  dot={{ r: 4, fill: appChartColors.rose }}
                  hide={composedLegend.isHidden("conversion")}
                />
              </ComposedChart>
            </AppChart>
          </AppCard>
        </div>
      </UiKitSection>

      <UiKitSection
        index="10"
        title="Data Table"
        description="Поиск, фильтры, мультисортировка, выбор строк, раскрываемые детали, массовые действия, колонки и пагинация."
      >
        <AppDataTable
          data={demoProducts}
          columns={demoProductColumns}
          rowId={(row) => row.id}
          mobileFilterDialog
          renderMobileRow={(row) => (
            <div className="ui-kit-mobile-data-row">
              <strong>{row.name}</strong>
              <span>Артикул: {row.sku}</span>
              <span>На складе: {row.stock}</span>
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => appToast.info(`Открыт товар: ${row.name}`)}
              >
                Открыть товар
              </AppButton>
            </div>
          )}
          rowClassName={(row) => (row.stock < 10 ? "ui-kit-row--low-stock" : undefined)}
          onRowDoubleClick={(row) => appToast.info(`Двойной щелчок: ${row.name}`)}
          contextMenuActions={(row) => [
            {
              label: "Открыть",
              icon: <Eye size={16} />,
              onSelect: () => appToast.info(`Открыт товар: ${row.name}`),
            },
            {
              label: "В архив",
              icon: <Archive size={16} />,
              separatorBefore: true,
              onSelect: () => appToast.info(`Товар отправлен в архив: ${row.name}`),
            },
          ]}
          contextMenuLabel={(row) => `Действия: ${row.name}`}
          defaultPageSize={10}
          bulkActions={[
            {
              label: "В архив",
              icon: <Archive size={15} />,
              onSelect: (rows) => appToast.info(`В архив отправлено: ${rows.length}`),
            },
            {
              label: "Удалить",
              icon: <Trash2 size={15} />,
              tone: "danger",
              onSelect: (rows) => appToast.error(`Выбрано для удаления: ${rows.length}`),
            },
          ]}
        />

        <div className="ui-kit-expandable-table-demo">
          <div>
            <h3>Раскрываемая строка</h3>
            <p>Нажмите на строку, чтобы показать полноширинные детали непосредственно под ней.</p>
          </div>
          <AppDataTable
            data={demoProducts.slice(0, 3)}
            columns={demoProductColumns.slice(0, 4)}
            rowId={(row) => row.id}
            searchable={false}
            selectable={false}
            pagination={false}
            expandedRowId={expandedDemoProductId}
            onExpandedRowIdChange={setExpandedDemoProductId}
            renderExpandedRow={(row) => (
              <div className="ui-kit-expandable-table-demo__details">
                <strong>{row.name}</strong>
                <span>
                  Здесь размещаются связанные данные, графики или действия по выбранной записи.
                </span>
              </div>
            )}
          />
        </div>

        <div className="ui-kit-grouped-table-demo">
          <div>
            <h3>Группы внутри таблицы</h3>
            <p>
              Заголовок группы остаётся на месте при сворачивании, а дочерние строки визуально
              отделены от неё.
            </p>
          </div>
          <AppDataTable
            data={[...demoProducts]
              .sort((first, second) => first.category.localeCompare(second.category))
              .slice(0, 12)}
            columns={demoProductColumns.slice(0, 4)}
            rowId={(row) => `grouped-${row.id}`}
            searchable={false}
            selectable={false}
            pagination={false}
            groupBy={(row) => row.category}
            collapsedGroupIds={collapsedDemoCategories}
            groupRowClassName={() => "ui-kit-grouped-table-demo__group-row"}
            renderGroupHeader={(group) => (
              <div className="ui-kit-grouped-table-demo__header">
                <span>
                  <strong>{group.id}</strong>
                  <small>Позиций: {group.rows.length}</small>
                </span>
                <button type="button" onClick={() => toggleDemoCategory(group.id)}>
                  {group.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  {group.collapsed ? "Развернуть" : "Свернуть"}
                </button>
              </div>
            )}
            rowClassName={() => "ui-kit-grouped-table-demo__child-row"}
          />
        </div>

        <div className="ui-kit-infinite-table-demo">
          <div>
            <h3>Local search + virtualization</h3>
            <p>
              Клиентская таблица без пагинации ищет и сортирует по всему набору, но отображает в DOM
              только видимые строки.
            </p>
          </div>
          <AppDataTable
            data={demoProducts}
            columns={demoProductColumns.slice(0, 5)}
            rowId={(row) => row.id}
            pagination={false}
            virtualized
            scrollHeight={320}
            rowHeight={48}
            overscan={3}
          />

          <div>
            <h3>Infinite scroll + virtualization</h3>
            <p>
              Прокрутите таблицу вниз: новые строки добавляются порциями, а в DOM остаётся только
              видимое окно с небольшим запасом.
            </p>
          </div>
          <AppDataTable
            data={demoProducts.slice(0, infiniteDemoCount)}
            columns={demoProductColumns.slice(0, 5)}
            rowId={(row) => row.id}
            mode="infinite"
            virtualized
            scrollHeight={320}
            rowHeight={48}
            overscan={3}
            totalItems={demoProducts.length}
            hasMore={infiniteDemoCount < demoProducts.length}
            loadingMore={infiniteDemoLoading}
            onLoadMore={loadMoreDemoProducts}
            searchable={false}
          />
        </div>
      </UiKitSection>

      <UiKitSection
        index="11"
        title="Tree Data Table"
        description="Деревовидная таблица с раскрытием узлов, поиском по дочерним записям, фильтрами, сортировкой и каскадным выбором."
      >
        <div className="ui-kit-tree-table-stack">
          <AppTreeDataTable
            data={demoTreeData}
            columns={demoTreeColumns}
            rowId={(row) => String(row.id)}
            getChildren={(row) => row.children}
            treeColumnId="name"
            searchable
            selectable
            selectionBehavior="cascade"
            showChildCount
            defaultExpandedIds={["1", "11", "2", "21"]}
            defaultPageSize={8}
            pageSizes={[5, 8, 12]}
            bulkActions={demoTreeBulkActions}
            emptyTitle="Категории не найдены"
            emptyDescription="Создайте первую категорию или измените параметры поиска."
          />

          <div className="ui-kit-tree-table-states">
            <AppCard title="Loading">
              <AppTreeDataTable
                data={[]}
                columns={demoTreeColumns}
                rowId={(row) => String(row.id)}
                getChildren={(row) => row.children}
                treeColumnId="name"
                loading
                searchable={false}
                selectable={false}
                defaultPageSize={5}
                pageSizes={[5]}
              />
            </AppCard>
            <AppCard title="Empty">
              <AppTreeDataTable
                data={[]}
                columns={demoTreeColumns}
                rowId={(row) => String(row.id)}
                getChildren={(row) => row.children}
                treeColumnId="name"
                searchable={false}
                selectable={false}
                defaultPageSize={5}
                pageSizes={[5]}
                emptyTitle="Категории не найдены"
                emptyDescription="Попробуйте изменить фильтры или создать новую категорию."
              />
            </AppCard>
            <AppCard title="Error">
              <AppTreeDataTable
                data={[]}
                columns={demoTreeColumns}
                rowId={(row) => String(row.id)}
                getChildren={(row) => row.children}
                treeColumnId="name"
                error="Сервис временно недоступен. Повторите попытку позже."
                searchable={false}
                selectable={false}
                defaultPageSize={5}
                pageSizes={[5]}
              />
            </AppCard>
          </div>
        </div>
      </UiKitSection>

      <UiKitSection
        index="12"
        title="Состояния таблицы"
        description="Loading, empty и error используют ту же геометрию и не требуют отдельной разметки."
      >
        <div className="ui-kit-table-states">
          <AppCard title="Loading">
            <AppDataTable
              data={[]}
              columns={demoProductColumns.slice(0, 4)}
              rowId={(row) => row.id}
              loading
              searchable={false}
              selectable={false}
              defaultPageSize={5}
              pageSizes={[5]}
            />
          </AppCard>
          <AppCard title="Empty">
            <AppDataTable
              data={[]}
              columns={demoProductColumns.slice(0, 4)}
              rowId={(row) => row.id}
              searchable={false}
              selectable={false}
              defaultPageSize={5}
              pageSizes={[5]}
              emptyTitle="Товары не найдены"
              emptyDescription="Попробуйте изменить фильтры или создать новый товар."
            />
          </AppCard>
          <AppCard title="Error">
            <AppDataTable
              data={[]}
              columns={demoProductColumns.slice(0, 4)}
              rowId={(row) => row.id}
              error="Сервис временно недоступен. Повторите попытку позже."
              searchable={false}
              selectable={false}
              defaultPageSize={5}
              pageSizes={[5]}
            />
          </AppCard>
        </div>
      </UiKitSection>

      <UiKitSection
        index="13"
        title="Public Store"
        description="Компоненты витрины магазина: поиск, карточки, фильтры, теги и пустые состояния."
      >
        <div className="ui-kit-public-grid">
          <AppCard title="StoreSearch" description="Поиск по товарам и категориям с подсказками">
            <StoreSearch
              categories={storeUiCategories}
              value="кот"
              onValueChange={() => undefined}
            />
          </AppCard>

          <AppCard
            title="CatalogToolbar"
            description="Заголовок, счетчик, сортировка и кнопка фильтров"
          >
            <CatalogToolbar
              query="кот"
              totalItems={18}
              page={2}
              totalPages={6}
              sort="popular"
              onSortChange={() => undefined}
              onOpenFilters={() => undefined}
            />
          </AppCard>

          <AppCard title="CatalogFilters" description="Категории, цена и наличие">
            <CatalogFilters
              categories={storeUiCategories}
              categoryCounts={countProductsByCategory(storeUiProducts)}
              value={{ query: "", category: "", minPrice: "", maxPrice: "", inStock: false }}
              onChange={() => undefined}
            />
          </AppCard>

          <AppCard title="ActiveFilterTags" description="Выбранные фильтры">
            <ActiveFilterTags
              tags={[
                { id: "query", label: "Поиск: кот", onRemove: () => undefined },
                { id: "stock", label: "В наличии", onRemove: () => undefined },
              ]}
              onReset={() => undefined}
            />
          </AppCard>

          <AppCard title="CategoryCard" description="Категория с изображением и количеством">
            <div className="ui-kit-public-grid--tight">
              {storeUiCategories.map((category) => (
                <CategoryCard
                  key={category.slug}
                  category={category}
                  count={
                    countProductsByCategory(storeUiProducts)[
                      String(category.id ?? category.slug)
                    ] ?? 0
                  }
                />
              ))}
            </div>
          </AppCard>

          <AppCard title="ProductCard / Grid" description="Карточка товара и сетка">
            <ProductGrid products={storeUiProducts} />
          </AppCard>

          <AppCard title="PromoCategoryCard" description="Промо-блок категории">
            <div className="ui-kit-public-grid--promo">
              <PromoCategoryCard category={storeUiCategories[0]} />
              <PromoCategoryCard category={storeUiCategories[1]} compact />
            </div>
          </AppCard>

          <AppCard title="Pagination" description="Переход по страницам каталога">
            <Pagination
              page={paginationPreviewPage}
              totalPages={31}
              onPageChange={setPaginationPreviewPage}
            />
          </AppCard>

          <AppCard title="StoreEmptyState" description="Пустая выдача или отсутствие товаров">
            <StoreEmptyState
              title="Ничего не найдено"
              description="Попробуйте изменить запрос, категорию или цену."
              actionLabel="Сбросить"
              onAction={() => undefined}
            />
          </AppCard>
        </div>
      </UiKitSection>

      <div className="ui-kit-footer-note">
        <Info size={18} />
        Страница не добавлена в меню и доступна только авторизованным пользователям по прямой
        ссылке.
      </div>
    </AdminPage>
  );
}
