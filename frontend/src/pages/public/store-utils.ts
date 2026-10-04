import { Category, Product, ProductImage } from "@/shared/types/models";

const moneyFormat = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 0 });

export type CatalogSort = "popular" | "price-asc" | "price-desc" | "name" | "newest";

export type CatalogFiltersState = {
  query: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  inStock: boolean;
  sort: CatalogSort;
  page: number;
  size: number;
};

export function formatMoney(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "Цена по запросу";
  return `${moneyFormat.format(value)} ₸`;
}

export function formatDiscountPercent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value);
}

export function hasPersonalDiscount(
  price?: number | null,
  regularPrice?: number | null,
  personalDiscountPercent?: number | null,
) {
  return Boolean(
    price !== undefined &&
    price !== null &&
    regularPrice !== undefined &&
    regularPrice !== null &&
    regularPrice > price &&
    personalDiscountPercent !== undefined &&
    personalDiscountPercent !== null &&
    personalDiscountPercent > 0,
  );
}

export function hasPriceChange(price?: number | null, regularPrice?: number | null) {
  return Boolean(
    price !== undefined &&
    price !== null &&
    regularPrice !== undefined &&
    regularPrice !== null &&
    regularPrice !== price,
  );
}

export function normalizeText(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/қ/g, "к")
    .replace(/ғ/g, "г")
    .replace(/ң/g, "н")
    .replace(/ү/g, "у")
    .replace(/ұ/g, "у")
    .replace(/і/g, "и")
    .trim();
}

export function getProductImage(product: Product) {
  return product.images?.find((image) => image.mainImage) ?? product.images?.[0] ?? null;
}

export function getCategoryImage(category: Category) {
  return category.imageFilePath ? category.imageFilePath : null;
}

export function isRenderableCategory(category: Category) {
  return Boolean(
    category.id != null &&
    (category.nameRu?.trim() || category.nameKk?.trim()) &&
    category.slug?.trim(),
  );
}

export function flattenCategories(categories: Category[]) {
  const result: Category[] = [];
  const stack = [...categories];

  while (stack.length) {
    const current = stack.shift();
    if (!current) continue;
    if (!isRenderableCategory(current)) continue;
    result.push(current);
    if (current.children?.length) stack.unshift(...current.children);
  }

  return result;
}

export function countProductsByCategory(products: Product[]) {
  return products.reduce<Record<string, number>>((acc, product) => {
    if (product.categoryId === undefined || product.categoryId === null) return acc;
    const key = String(product.categoryId);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

export function isProductInStock(product: Product) {
  return product.active;
}

export function getProductStatusLabel(product: Product) {
  if (!product.active) return "Скрыт";
  if (product.madeToOrder) return getProductDeliveryTerm(product);
  return "В наличии";
}

export function getProductDeliveryTerm(product: Product) {
  const from = product.deliveryDaysFrom;
  const to = product.deliveryDaysTo;
  if (from != null && to != null) return `Доставка от ${from} до ${to} дней`;
  if (from != null) return `Доставка от ${from} дней`;
  if (to != null) return `Доставка до ${to} дней`;
  return "На заказ";
}

export function getProductAvailabilityTone(product: Product): "green" | "orange" | "red" {
  if (!product.active) return "red";
  if (product.madeToOrder) return "orange";
  return "green";
}

export function getProductSearchIndex(product: Product) {
  return normalizeText(
    [
      product.nameRu,
      product.nameKk,
      product.sku,
      product.categoryNameRu,
      product.shortDescriptionRu,
      product.descriptionRu,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function getCategorySearchIndex(category: Category) {
  return normalizeText(
    [
      category.nameRu,
      category.nameKk,
      category.slug,
      category.descriptionRu,
      category.descriptionKk,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function filterProducts(
  products: Product[],
  categories: Category[],
  filters: CatalogFiltersState,
) {
  const query = normalizeText(filters.query);
  const selectedCategory = filters.category;
  const minPrice = filters.minPrice ? Number(filters.minPrice) : null;
  const maxPrice = filters.maxPrice ? Number(filters.maxPrice) : null;
  const categoryIds = new Set(
    selectedCategory
      ? flattenCategories(categories)
          .filter(
            (category) =>
              category.slug === selectedCategory || String(category.id) === selectedCategory,
          )
          .map((category) => String(category.id))
      : [],
  );

  return products.filter((product) => {
    const matchesQuery = !query || getProductSearchIndex(product).includes(query);
    const matchesCategory =
      !selectedCategory ||
      (product.categoryId !== undefined &&
        product.categoryId !== null &&
        categoryIds.has(String(product.categoryId))) ||
      (product.categoryNameRu && normalizeText(product.categoryNameRu).includes(query) && !query);
    const matchesMin = minPrice === null || (product.price !== null && product.price >= minPrice);
    const matchesMax = maxPrice === null || (product.price !== null && product.price <= maxPrice);
    const matchesStock = !filters.inStock || isProductInStock(product);
    return matchesQuery && matchesCategory && matchesMin && matchesMax && matchesStock;
  });
}

export function sortProducts(products: Product[], sort: CatalogSort) {
  const sorted = [...products];

  switch (sort) {
    case "price-asc":
      return sorted.sort(
        (a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY),
      );
    case "price-desc":
      return sorted.sort(
        (a, b) => (b.price ?? Number.NEGATIVE_INFINITY) - (a.price ?? Number.NEGATIVE_INFINITY),
      );
    case "name":
      return sorted.sort((a, b) => a.nameRu.localeCompare(b.nameRu, "ru"));
    case "newest":
      return sorted.sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0));
    case "popular":
    default:
      return sorted.sort(
        (a, b) => Number(b.active) - Number(a.active) || a.nameRu.localeCompare(b.nameRu, "ru"),
      );
  }
}

export function paginate<T>(items: T[], page: number, size: number) {
  const safeSize = Math.max(size, 1);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safeSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * safeSize;

  return {
    items: items.slice(start, start + safeSize),
    totalItems,
    totalPages,
    page: currentPage,
    size: safeSize,
  };
}

export function buildPaginationRange(page: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  return Array.from(pages)
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b)
    .reduce<Array<number | "ellipsis">>((acc, value, index, array) => {
      acc.push(value);
      const next = array[index + 1];
      if (next && next - value > 1) acc.push("ellipsis");
      return acc;
    }, []);
}

export function parseBoolean(value: string | null) {
  return value === "1" || value === "true";
}

export function buildCatalogQuery(filters: CatalogFiltersState) {
  const params = new URLSearchParams();
  if (filters.query) params.set("query", filters.query);
  if (filters.category) params.set("category", filters.category);
  if (filters.minPrice) params.set("minPrice", filters.minPrice);
  if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);
  if (filters.inStock) params.set("inStock", "true");
  if (filters.sort !== "popular") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.size !== 12) params.set("size", String(filters.size));
  return params.toString();
}

export function parseCatalogFilters(searchParams: URLSearchParams): CatalogFiltersState {
  return {
    query: searchParams.get("query") ?? "",
    category: searchParams.get("category") ?? "",
    minPrice: searchParams.get("minPrice") ?? "",
    maxPrice: searchParams.get("maxPrice") ?? "",
    inStock: parseBoolean(searchParams.get("inStock")),
    sort: (searchParams.get("sort") as CatalogSort) ?? "popular",
    page: Math.max(Number(searchParams.get("page") ?? "1") || 1, 1),
    size: Math.max(Number(searchParams.get("size") ?? "12") || 12, 1),
  };
}

export function getCategoryCountLabel(count?: number) {
  if (!count) return "Нет товаров";
  if (count === 1) return "1 товар";
  if (count < 5) return `${count} товара`;
  return `${count} товаров`;
}

export function getProductMainImageSrc(image: ProductImage | null) {
  return image?.filePath ?? "";
}
