import { type MouseEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SortingState } from "@tanstack/react-table";
import { CheckCircle2, Edit, FileText, GitBranch, Layers3, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api, API_URL } from "@/shared/api/http";
import { fetchAllCategories, fetchCategoryPage } from "@/shared/api/catalog";
import { Category } from "@/shared/types/models";
import { AdminPage } from "@/layouts/AdminPage";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import {
  AppDataTable,
  type AppDataTableColumn,
  type AppDataTableFilterValues,
} from "@/shared/ui/AppDataTable";
import { AppContextMenu, type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppModal } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import { appToast } from "@/shared/ui/AppToast";
import "./CategoriesPage.css";

function isRenderableCategory(category: Category) {
  return category.id != null && Boolean(category.nameRu) && Boolean(category.slug);
}

export function CategoriesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [categoryContextMenu, setCategoryContextMenu] = useState<{
    category: Category;
    x: number;
    y: number;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sorting, setSorting] = useState<SortingState>([{ id: "sortOrder", desc: false }]);
  const [filterValues, setFilterValues] = useState<AppDataTableFilterValues>({});

  const categoriesQuery = useQuery({
    queryKey: ["categories", "admin", search, page, pageSize, sorting, filterValues],
    queryFn: () => {
      const statusFilter = filterValues.active?.length === 1 ? filterValues.active[0] : undefined;
      return fetchCategoryPage({
        page,
        size: pageSize,
        search: search || undefined,
        active: statusFilter === "active" ? true : statusFilter === "hidden" ? false : undefined,
        sort: sorting[0]?.id ?? "sortOrder",
        direction: sorting[0]?.desc ? "desc" : "asc",
      });
    },
  });
  const allCategoriesQuery = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => fetchAllCategories(),
  });

  const categories = categoriesQuery.data?.items ?? [];
  const allCategories = allCategoriesQuery.data ?? [];
  const rootCategoriesCount = useMemo(
    () =>
      allCategories.filter((category) => isRenderableCategory(category) && !category.parentId)
        .length,
    [allCategories],
  );

  const remove = useMutation({
    mutationFn: (category: Category) => api(`/api/categories/${category.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      appToast.success("Категория удалена");
      setDeleteTarget(null);
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : "Не удалось удалить категорию");
    },
  });

  function categoryActions(category: Category): AppContextMenuAction[] {
    return [
      {
        label: "Редактировать",
        icon: <Edit size={17} />,
        onSelect: () => navigate(`/admin/categories/${category.id}`),
      },
      {
        label: "Удалить",
        icon: <Trash2 size={17} />,
        disabled: !category.id,
        destructive: true,
        separatorBefore: true,
        onSelect: () => setDeleteTarget(category),
      },
    ];
  }

  function openCategoryContextMenu(category: Category, event: MouseEvent<HTMLTableRowElement>) {
    event.preventDefault();
    setCategoryContextMenu({ category, x: event.clientX, y: event.clientY });
  }

  const columns: AppDataTableColumn<Category>[] = [
    {
      id: "image",
      header: "Картинка",
      hideable: false,
      width: 88,
      value: (category) => category.imageFilePath ?? "",
      cell: (category) => (
        <div
          className="category-thumbnail"
          aria-label={category.imageOriginalFileName || category.nameRu}
        >
          {category.imageFilePath ? (
            <img
              src={`${API_URL}${category.imageFilePath}`}
              alt={category.imageOriginalFileName || category.nameRu}
            />
          ) : (
            <span>—</span>
          )}
        </div>
      ),
    },
    {
      id: "nameRu",
      header: "Название",
      accessor: "nameRu",
      sortable: true,
      cell: (category) => (
        <div className="category-name">
          <div className="category-name__content">
            <strong>{category.nameRu}</strong>
            <span>{category.nameKk}</span>
          </div>
        </div>
      ),
    },
    {
      id: "parentNameRu",
      header: "Родительская категория",
      sortable: true,
      cell: (category) => category.parentNameRu ?? "Корневая",
    },
    {
      id: "slug",
      header: "Slug",
      accessor: "slug",
      sortable: true,
      cell: (category) => <code>{category.slug}</code>,
    },
    {
      id: "sortOrder",
      header: "Сортировка",
      accessor: "sortOrder",
      sortable: true,
      align: "right",
      cell: (category) => category.sortOrder,
    },
    {
      id: "active",
      header: "Статус",
      value: (category) => (category.active ? "active" : "hidden"),
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: "active", label: "Активные" },
        { value: "hidden", label: "Скрытые" },
      ],
      cell: (category) => (
        <AppBadge tone={category.active ? "green" : "slate"}>
          {category.active ? "Активна" : "Скрыта"}
        </AppBadge>
      ),
    },
    {
      id: "actions",
      header: "",
      hideable: false,
      width: 56,
      align: "right",
      cell: (category) => (
        <AppActionMenu label={`Действия: ${category.nameRu}`} actions={categoryActions(category)} />
      ),
    },
  ];

  const errorMessage = categoriesQuery.error
    ? categoriesQuery.error instanceof Error
      ? categoriesQuery.error.message
      : "Не удалось загрузить категории"
    : undefined;

  return (
    <AdminPage
      eyebrow="Товары и услуги"
      title="Категории"
      actions={
        <AppButton asChild>
          <Link to="/admin/categories/new">
            <Plus size={18} />
            Создать категорию
          </Link>
        </AppButton>
      }
    >
      <div className="metric-grid">
        <MetricCard
          icon={<Layers3 size={18} />}
          label="Всего категорий"
          value={categoriesQuery.data?.totalItems ?? 0}
          size="compact"
        />
        <MetricCard
          icon={<CheckCircle2 size={18} />}
          label="Активные"
          value={allCategories.filter((category) => category.active).length}
          accent
          size="compact"
        />
        <MetricCard
          icon={<GitBranch size={18} />}
          label="Корневые"
          value={rootCategoriesCount}
          size="compact"
        />
        <MetricCard
          icon={<FileText size={18} />}
          label="Без описания"
          value={
            allCategories.filter((category) => !category.descriptionRu && !category.descriptionKk)
              .length
          }
          size="compact"
        />
      </div>

      <DataPanel title="Каталог категорий">
        <AppDataTable
          data={categories}
          columns={columns}
          rowId={(category) => String(category.id)}
          onRowContextMenu={openCategoryContextMenu}
          loading={categoriesQuery.isLoading}
          error={errorMessage}
          mode="server"
          searchable
          selectable={false}
          defaultPageSize={10}
          searchValue={search}
          onSearchChange={setSearch}
          filterValues={filterValues}
          onFilterValuesChange={setFilterValues}
          sortingState={sorting}
          onSortingStateChange={setSorting}
          page={categoriesQuery.data?.page ?? page}
          pageSize={categoriesQuery.data?.size ?? pageSize}
          totalItems={categoriesQuery.data?.totalItems ?? 0}
          totalPages={categoriesQuery.data?.totalPages ?? 1}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          emptyTitle="Категории не найдены"
          emptyDescription="Создайте первую категорию или измените параметры поиска и фильтров."
        />
      </DataPanel>

      <AppContextMenu
        open={Boolean(categoryContextMenu)}
        x={categoryContextMenu?.x ?? 0}
        y={categoryContextMenu?.y ?? 0}
        label={
          categoryContextMenu
            ? `Действия: ${categoryContextMenu.category.nameRu}`
            : "Действия с категорией"
        }
        actions={categoryContextMenu ? categoryActions(categoryContextMenu.category) : []}
        onOpenChange={(open) => {
          if (!open) setCategoryContextMenu(null);
        }}
      />

      <AppModal
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Удалить категорию?"
        description="Удаление скроет категорию из каталога. Дочерние категории останутся в системе."
      >
        <div className="delete-category-modal">
          <strong>{deleteTarget?.nameRu}</strong>
          <p>{deleteTarget?.slug && <code>{deleteTarget.slug}</code>}</p>
          <div className="delete-category-modal__actions">
            <AppButton type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
              Отмена
            </AppButton>
            <AppButton
              type="button"
              variant="danger"
              loading={remove.isPending}
              loadingText="Удаление..."
              onClick={() => deleteTarget && remove.mutate(deleteTarget)}
            >
              Удалить
            </AppButton>
          </div>
        </div>
      </AppModal>
    </AdminPage>
  );
}
