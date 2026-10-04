import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  fetchCategoryCounts,
  fetchStoreCategoryPage,
  fetchStoreCategoryTree,
} from "@/shared/api/catalog";
import { StoreLayout } from "@/layouts/StoreLayout";
import { CategoryCard } from "@/pages/public/CategoryCard";
import { Pagination } from "@/pages/public/Pagination";
import { StoreEmptyState } from "@/pages/public/StoreEmptyState";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppSearchInput } from "@/shared/ui/AppField";
import { SeoMeta } from "@/shared/seo/SeoMeta";
import "./CategoriesCatalogPage.css";

const PAGE_SIZE = 12;

export function CategoriesCatalogPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const layoutCategoriesQuery = useQuery({
    queryKey: ["categories", "tree"],
    queryFn: fetchStoreCategoryTree,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", "catalog", search, page],
    queryFn: () =>
      fetchStoreCategoryPage({
        page,
        size: PAGE_SIZE,
        search: search || undefined,
        active: true,
        sort: "sortOrder",
        direction: "asc",
      }),
  });
  const categoryCountsQuery = useQuery({
    queryKey: ["products", "category-counts"],
    queryFn: () => fetchCategoryCounts(),
  });

  const categories = categoriesQuery.data?.items ?? [];
  const layoutCategories = layoutCategoriesQuery.data ?? [];
  const pagination = categoriesQuery.data;
  const productCounts = categoryCountsQuery.data ?? {};

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    if (pagination && page !== pagination.page) {
      setPage(pagination.page);
    }
  }, [page, pagination]);

  return (
    <StoreLayout categories={layoutCategories}>
      <SeoMeta
        title="Категории продуктов | GastroFlow"
        description="Категории овощей, фруктов, бакалеи и паназиатских продуктов GastroFlow."
        canonicalPath="/categories"
      />
      <section className="categories-page">
        <div className="categories-page__hero">
          <div>
            <p>Каталог категорий</p>
            <h1>Все категории</h1>
            <span>
              Быстрый переход по разделам каталога без сложных фильтров. Достаточно найти нужную
              категорию по названию или описанию.
            </span>
          </div>
          <AppButton asChild variant="secondary">
            <Link to="/catalog">Смотреть товары</Link>
          </AppButton>
        </div>

        <AppCard className="categories-page__search-card">
          <div className="categories-page__search-head">
            <div>
              <strong>Поиск по категориям</strong>
              <span>Найдено: {pagination?.totalItems ?? 0}</span>
            </div>
          </div>
          <AppSearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск"
            aria-label="Поиск по категориям"
          />
        </AppCard>

        {categoriesQuery.isLoading ? (
          <div className="categories-page__grid categories-page__grid--loading">
            {Array.from({ length: 8 }, (_, index) => (
              <AppCard key={index}>
                <AppSkeleton />
              </AppCard>
            ))}
          </div>
        ) : categories.length > 0 && pagination ? (
          <div className="categories-page__results">
            <div className="categories-page__grid">
              {categories.map((category) => (
                <CategoryCard
                  key={category.id ?? category.slug}
                  category={category}
                  count={productCounts[String(category.id ?? category.slug)] ?? 0}
                />
              ))}
            </div>
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={setPage}
            />
          </div>
        ) : (
          <StoreEmptyState
            title="Категории не найдены"
            description="Попробуйте изменить поисковый запрос или очистить строку поиска."
            actionLabel="Сбросить поиск"
            onAction={() => {
              setSearch("");
              setPage(1);
            }}
          />
        )}
      </section>
    </StoreLayout>
  );
}
