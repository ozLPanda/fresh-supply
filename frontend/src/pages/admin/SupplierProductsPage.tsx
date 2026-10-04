import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import {
  fetchSupplierProducts,
  fetchSuppliers,
  SUPPLIER_PRODUCTS_KEY,
  type SupplierProduct,
} from "@/shared/api/supplierProducts";
import { SupplierImportQueue } from "@/shared/components/supplier-products/SupplierImportQueue";
import { useSupplierImportQueue } from "@/shared/components/supplier-products/useSupplierImportQueue";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppSelect } from "@/shared/ui/AppField";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import "./SupplierProductsPage.css";

const sortFields = [
  "name",
  "sku",
  "supplierName",
  "brand",
  "purchasePrice",
  "retailPrice",
  "syncedAt",
];
const pageSizes = [10, 25, 50, 100];
const money = (value: number | null) =>
  value === null
    ? "Не указана"
    : new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value);
export function SupplierProductsPage() {
  const { user } = useCommerce();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const supplier = params.get("supplier") ?? "";
  const requestedPage = Number(params.get("page"));
  const requestedSize = Number(params.get("size"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const size = pageSizes.includes(requestedSize) ? requestedSize : 25;
  const sort = sortFields.includes(params.get("sort") ?? "") ? params.get("sort")! : "name";
  const direction = params.get("direction") === "desc" ? "desc" : "asc";
  const suppliers = useQuery({
    queryKey: ["supplier-product-suppliers", user?.id],
    queryFn: fetchSuppliers,
  });
  const products = useQuery({
    queryKey: [...SUPPLIER_PRODUCTS_KEY, user?.id, supplier, query, page, size, sort, direction],
    queryFn: () => fetchSupplierProducts({ supplier, query, page, size, sort, direction }),
  });
  const { query: queue, retry, syncStatus } = useSupplierImportQueue(user?.id);
  const canImport = Boolean(
    user?.permissions.includes("supplier-products.import") &&
    user.permissions.includes("pages.mks.view") &&
    user.permissions.includes("pages.supplier-products.view"),
  );
  function update(values: Record<string, string>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(values))
          value ? next.set(key, value) : next.delete(key);
        return next;
      },
      { replace: true },
    );
  }
  function openProduct(product: SupplierProduct) {
    navigate(`/admin/products/suppliers/${product.id}`, {
      state: { returnTo: `${location.pathname}${location.search}${location.hash}` },
    });
  }
  const columns: AppDataTableColumn<SupplierProduct>[] = [
    { id: "sku", header: "Артикул", accessor: "sku", width: 160 },
    {
      id: "name",
      header: "Товар",
      accessor: "name",
      width: 360,
      cell: (item) => (
        <div className="supplier-products__product">
          {item.imageUrl && (
            <img
              src={item.imageUrl}
              alt=""
              width={50}
              height={50}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          )}
          <strong>{item.name}</strong>
        </div>
      ),
    },
    { id: "supplierName", header: "Поставщик", accessor: "supplierName" },
    { id: "brand", header: "Бренд", accessor: "brand", cell: (item) => item.brand || "—" },
    {
      id: "purchasePrice",
      header: "Цена для нас, ₸",
      accessor: "purchasePrice",
      align: "right",
      cell: (item) => money(item.purchasePrice),
    },
    {
      id: "retailPrice",
      header: "Розничная цена / МРЦ, ₸",
      accessor: "retailPrice",
      align: "right",
      cell: (item) => money(item.retailPrice),
    },
    {
      id: "availability",
      header: "Наличие у поставщика",
      accessor: "availability",
      cell: (item) => item.availability || "Не указано",
      sortable: false,
    },
  ];
  return (
    <AdminPage
      title="Товары поставщиков"
      eyebrow="Товары"
      className="supplier-products"
      actions={
        user?.permissions.includes("pages.mks.view") && (
          <Link
            className="supplier-products__catalog-link"
            to="/admin/mks-catalog"
            state={{ returnTo: `${location.pathname}${location.search}` }}
          >
            МКС · Выбрать товары для импорта
          </Link>
        )
      }
    >
      <SupplierImportQueue
        jobs={queue.data ?? []}
        syncStatus={syncStatus.data}
        syncError={syncStatus.error?.message}
        loading={queue.isFetching}
        error={queue.error?.message}
        updatedAt={queue.dataUpdatedAt}
        canRetry={canImport}
        retryingId={retry.isPending ? retry.variables : undefined}
        retryError={retry.error?.message}
        onRefresh={() => {
          void queue.refetch();
          void syncStatus.refetch();
        }}
        onRetry={(id) => retry.mutate(id)}
      />
      {suppliers.error && (
        <AppAlert title="Не удалось загрузить поставщиков" tone="danger">
          {suppliers.error.message}
        </AppAlert>
      )}
      <DataPanel title="Каталог товаров поставщиков">
        <p className="supplier-products__hint">
          Импортированные данные поставщиков. Для МКС розничная цена соответствует МРЦ. Цены и
          наличие обновляются ежедневно.
        </p>
        <AppDataTable
          data={products.data?.items ?? []}
          columns={columns}
          rowId={(item) => String(item.id)}
          onRowClick={openProduct}
          mode="server"
          selectable={false}
          sortingState={[{ id: sort, desc: direction === "desc" }]}
          onSortingStateChange={(value) =>
            update({
              sort: value[0]?.id ?? "name",
              direction: value[0]?.desc ? "desc" : "asc",
              page: "1",
            })
          }
          loading={products.isFetching}
          error={products.error?.message}
          searchPlaceholder="Название или артикул"
          searchValue={query}
          onSearchChange={(value) => update({ q: value, page: "1" })}
          page={page}
          pageSize={size}
          pageSizes={pageSizes}
          totalItems={products.data?.totalItems ?? 0}
          totalPages={products.data?.totalPages ?? 0}
          onPageChange={(value) => update({ page: String(value) })}
          onPageSizeChange={(value) => update({ size: String(value), page: "1" })}
          toolbarFilters={
            <div className="app-data-table__filter">
              <AppSelect
                ariaLabel="Поставщик"
                value={supplier}
                options={[
                  { value: "", label: "Все поставщики" },
                  ...(suppliers.data ?? []).map((item) => ({ value: item.code, label: item.name })),
                ]}
                onValueChange={(value) => update({ supplier: String(value), page: "1" })}
              />
            </div>
          }
          activeToolbarFilters={supplier ? 1 : 0}
          onClearToolbarFilters={() => update({ supplier: "", page: "1" })}
          emptyTitle="Товары не найдены"
          emptyDescription="Измените фильтры или откройте МКС и добавьте товары в очередь импорта."
        />
      </DataPanel>
    </AdminPage>
  );
}
