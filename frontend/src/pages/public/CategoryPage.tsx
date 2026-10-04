import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  fetchCategoryCounts,
  fetchStoreCategoryTree,
  fetchStoreProductSearchPage,
} from "@/shared/api/catalog";
import { recordSearchQuery } from "@/shared/api/searchQueries";
import { StoreLayout } from "@/layouts/StoreLayout";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppSearchInput } from "@/shared/ui/AppField";
import { SeoMeta } from "@/shared/seo/SeoMeta";
import { Pagination } from "@/pages/public/Pagination";
import { ProductGrid } from "@/pages/public/ProductGrid";
import { StoreEmptyState } from "@/pages/public/StoreEmptyState";
import { flattenCategories, isRenderableCategory } from "@/pages/public/store-utils";
import "./CategoryPage.css";

const PAGE_SIZE = 12;

export function CategoryPage() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPage = Math.max(Number(searchParams.get("page") ?? "1") || 1, 1);
  const searchQuery = searchParams.get("query")?.trim() ?? "";
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const categoriesQuery = useQuery({
    queryKey: ["categories", "tree"],
    queryFn: fetchStoreCategoryTree,
  });
  const productsQuery = useQuery({
    queryKey: ["products", "category", slug, searchQuery, requestedPage, PAGE_SIZE],
    queryFn: () =>
      fetchStoreProductSearchPage({
        category: slug,
        page: requestedPage,
        size: PAGE_SIZE,
        search: searchQuery || undefined,
        sort: "popular",
        direction: "asc",
      }),
    enabled: Boolean(slug),
  });
  const categoryCountsQuery = useQuery({
    queryKey: ["products", "category-counts"],
    queryFn: () => fetchCategoryCounts(),
  });

  const categories = useMemo(
    () => (categoriesQuery.data ?? []).filter(isRenderableCategory),
    [categoriesQuery.data],
  );
  const category = useMemo(
    () => flattenCategories(categories).find((item) => item.slug === slug),
    [categories, slug],
  );
  const productCounts = categoryCountsQuery.data ?? {};
  const products = productsQuery.data?.items ?? [];
  const pagination = productsQuery.data;

  useEffect(() => setSearchDraft(searchQuery), [searchQuery]);

  useEffect(() => {
    if (!pagination || requestedPage <= Math.max(pagination.totalPages, 1)) return;
    const nextPage = Math.max(pagination.totalPages, 1);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (nextPage > 1) next.set("page", String(nextPage));
        else next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [pagination, requestedPage, setSearchParams]);

  function changePage(nextPage: number) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage > 1) next.set("page", String(nextPage));
      else next.delete("page");
      return next;
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchDraft.trim();
    if (query) {
      void recordSearchQuery({ query, source: "CATEGORY", categorySlug: slug ?? null });
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (query) next.set("query", query);
      else next.delete("query");
      next.delete("page");
      return next;
    });
  }

  function clearSearch() {
    setSearchDraft("");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("query");
      next.delete("page");
      return next;
    });
  }

  const canonicalPath = `/catalog/${slug}${requestedPage > 1 ? `?page=${requestedPage}` : ""}`;

  return (
    <StoreLayout categories={categories}>
      {!category && (
        <SeoMeta
          title={
            categoriesQuery.isLoading
              ? "Загрузка категории | GastroFlow"
              : "Категория недоступна | GastroFlow"
          }
          description="Категория товаров не найдена или временно недоступна."
          canonicalPath={canonicalPath}
          pending={categoriesQuery.isLoading}
          robots={categoriesQuery.isLoading ? "index,follow" : "noindex,follow"}
        />
      )}
      {category && (
        <SeoMeta
          title={`${category.nameRu}${requestedPage > 1 ? ` — страница ${requestedPage}` : ""} — купить в GastroFlow`}
          description={
            category.descriptionRu?.trim() ||
            `Каталог продуктов категории «${category.nameRu}»: цены, наличие и заказ онлайн.`
          }
          canonicalPath={canonicalPath}
          image={category.imageFilePath ?? null}
          robots={
            searchQuery || productsQuery.isError || category.active === false
              ? "noindex,follow"
              : "index,follow"
          }
          structuredData={[
            {
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: `${category.nameRu} в Павлодаре`,
              description:
                category.descriptionRu?.trim() ||
                `Каталог продуктов категории «${category.nameRu}».`,
              url: `${window.location.origin}${canonicalPath}`,
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Главная", item: window.location.origin },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Каталог",
                  item: `${window.location.origin}/catalog`,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: category.nameRu,
                  item: `${window.location.origin}/catalog/${category.slug}`,
                },
              ],
            },
          ]}
        />
      )}
      <section className="category-page">
        {categoriesQuery.isLoading ? (
          <AppCard className="category-page__hero">
            <AppSkeleton />
          </AppCard>
        ) : category ? (
          <AppCard className="category-page__hero">
            <div className="category-page__hero-copy">
              <p>Категория каталога</p>
              <h1>{category.nameRu}</h1>
              <p>
                {category.descriptionRu ?? "Продукты выбранной категории в каталоге GastroFlow."}
              </p>
              <div className="category-page__hero-meta">
                <AppBadge tone="orange">
                  {pagination?.totalItems ??
                    productCounts[String(category.id ?? category.slug)] ??
                    products.length}{" "}
                  товаров
                </AppBadge>
                <AppButton asChild>
                  <Link to="/categories">К списку категорий</Link>
                </AppButton>
              </div>
            </div>
          </AppCard>
        ) : (
          <AppAlert title="Категория не найдена" tone="warning">
            Проверьте адрес категории или перейдите в общий каталог.
          </AppAlert>
        )}

        {category && (
          <AppCard
            className="category-page__search-card"
            title={`Поиск в категории «${category.nameRu}»`}
            description="Введите название товара или артикул — поиск не выйдет за пределы выбранной категории."
            actions={
              searchQuery && pagination ? (
                <AppBadge tone="slate">Найдено: {pagination.totalItems}</AppBadge>
              ) : undefined
            }
          >
            <form className="category-page__search-form" onSubmit={submitSearch} role="search">
              <AppSearchInput
                label="Название или артикул"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Поиск"
                maxLength={200}
                autoComplete="off"
              />
              <div className="category-page__search-actions">
                <AppButton type="submit">Найти</AppButton>
                {(searchQuery || searchDraft) && (
                  <AppButton type="button" variant="secondary" onClick={clearSearch}>
                    Очистить
                  </AppButton>
                )}
              </div>
            </form>
          </AppCard>
        )}

        <div className="category-page__content">
          {productsQuery.isLoading ? (
            <div className="category-page__loading">
              {Array.from({ length: 4 }, (_, index) => (
                <AppCard key={index}>
                  <AppSkeleton />
                </AppCard>
              ))}
            </div>
          ) : productsQuery.isError ? (
            <AppAlert title="Ошибка загрузки" tone="danger" onRetry={() => productsQuery.refetch()}>
              Не удалось получить товары этой категории. Повторите загрузку.
            </AppAlert>
          ) : products.length > 0 && pagination ? (
            <>
              <ProductGrid products={products} />
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={changePage}
              />
            </>
          ) : (
            <StoreEmptyState
              title={
                searchQuery
                  ? "По вашему запросу ничего не найдено"
                  : "В этой категории пока нет товаров"
              }
              description={
                searchQuery
                  ? "Попробуйте изменить название или артикул либо очистите строку поиска."
                  : "Когда товары будут привязаны к категории, они появятся здесь автоматически."
              }
              actionLabel={searchQuery ? "Очистить поиск" : "Посмотреть все товары"}
              onAction={searchQuery ? clearSearch : () => window.location.assign("/categories")}
            />
          )}
        </div>
      </section>
    </StoreLayout>
  );
}
