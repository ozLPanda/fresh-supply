import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Building2,
  Headphones,
  PackageCheck,
  Quote,
  ShieldCheck,
  Truck,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { API_URL } from "@/shared/api/http";
import {
  fetchCategoryCounts,
  fetchStoreCategoryTree,
  fetchStoreProductPage,
} from "@/shared/api/catalog";
import { fetchLatestReviews, fetchReviewSummary } from "@/shared/api/reviews";
import { StoreLayout } from "@/layouts/StoreLayout";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppSkeleton } from "@/shared/ui/AppFeedback";
import { CategoryCard } from "@/pages/public/CategoryCard";
import { ProductGrid } from "@/pages/public/ProductGrid";
import { StoreEmptyState } from "@/pages/public/StoreEmptyState";
import { StoreSearch } from "@/pages/public/StoreSearch";
import { recordSearchQuery } from "@/shared/api/searchQueries";
import { SeoMeta } from "@/shared/seo/SeoMeta";
import { isRenderableCategory } from "@/pages/public/store-utils";
import "./HomePage.css";
import "./HomeBenefitsAlternative.css";
import { HomeHeroAlternative } from "./HomeHeroAlternative";

const FEATURED_PRODUCTS_LIMIT = 6;

const benefits = [
  {
    icon: Truck,
    title: "Условия доставки",
    text: "Уточните доступные способы получения заказа перед оформлением.",
  },
  {
    icon: Headphones,
    title: "Вопросы по заказу",
    text: "Свяжитесь с нами, чтобы уточнить ассортимент и состав заказа.",
  },
  {
    icon: WalletCards,
    title: "Оптовые условия",
    text: "Уточните оптовые цены для нужного объёма закупки.",
  },
  {
    icon: PackageCheck,
    title: "Актуальное наличие",
    text: "Проверяйте статус выбранных продуктов в каталоге.",
  },
];

export function HomePage({ heroVariant = "default" }: { heroVariant?: "default" | "alternative" }) {
  const [search, setSearch] = useState("");
  const productsQuery = useQuery({
    queryKey: ["products", "home-featured"],
    queryFn: () => fetchStoreProductPage({ page: 1, size: FEATURED_PRODUCTS_LIMIT, active: true }),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", "tree"],
    queryFn: fetchStoreCategoryTree,
  });
  const categoryCountsQuery = useQuery({
    queryKey: ["products", "category-counts"],
    queryFn: () => fetchCategoryCounts(),
  });
  const reviewsQuery = useQuery({
    queryKey: ["reviews", "latest"],
    queryFn: () => fetchLatestReviews(3),
  });
  const reviewSummaryQuery = useQuery({
    queryKey: ["reviews", "summary"],
    queryFn: () => fetchReviewSummary(),
  });

  const products = productsQuery.data?.items ?? [];
  const categories = categoriesQuery.data ?? [];
  const productCounts = categoryCountsQuery.data ?? {};
  const latestReviews = reviewsQuery.data?.items ?? [];
  const reviewSummary = reviewSummaryQuery.data;
  const featuredProducts = useMemo(
    () => products.filter((product) => product.active !== false).slice(0, FEATURED_PRODUCTS_LIMIT),
    [products],
  );
  const featuredCategories = useMemo(
    () =>
      categories
        .filter((category) => category.active !== false && isRenderableCategory(category))
        .slice(0, 4),
    [categories],
  );

  return (
    <StoreLayout categories={categories}>
      <SeoMeta
        title="GastroFlow — паназиатские продукты"
        description="Овощи, фрукты, бакалея и паназиатские продукты. Каталог, цены и заказ онлайн."
        canonicalPath="/"
        structuredData={{
          "@context": "https://schema.org",
          "@type": ["OnlineStore", "LocalBusiness"],
          name: "GastroFlow",
          url: window.location.origin,
          logo: `${window.location.origin}/brand/gastroflow-logo.png`,
          telephone: "+7 777 459 32 33",
          address: {
            "@type": "PostalAddress",
            streetAddress: "Генерала Дюсенова, 154",
            addressLocality: "Павлодар",
            addressCountry: "KZ",
          },
          areaServed: { "@type": "City", name: "Павлодар" },
        }}
      />
      {heroVariant === "alternative" ? (
        <HomeHeroAlternative categories={categories} />
      ) : (
        <section className="home-hero">
          <div className="home-hero__background" aria-hidden="true" />
          <div className="home-hero__inner">
            <div className="home-hero__copy">
              <AppBadge tone="orange">Овощи • Фрукты • Бакалея</AppBadge>
              <h1>
                Свежие продукты <span>для вашей кухни</span>
              </h1>
              <p>
                Овощи, фрукты, бакалея и ингредиенты для паназиатской кухни. Соберите всё
                необходимое для вашего меню в одном заказе.
              </p>
              <div className="home-hero__search">
                <StoreSearch
                  categories={categories}
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Поиск"
                  searchSource="HOME"
                  onSearchCommitted={(query) => void recordSearchQuery({ query, source: "HOME" })}
                />
                <span>Ищите продукты по названию или артикулу.</span>
              </div>
              <div className="home-hero__actions">
                <AppButton asChild>
                  <Link to="/catalog">
                    Перейти в каталог
                    <ArrowRight size={18} />
                  </Link>
                </AppButton>
                <AppButton asChild variant="secondary">
                  <a href="tel:+77774593233">
                    <Headphones size={18} />
                    Получить консультацию
                  </a>
                </AppButton>
              </div>
              <div className="home-hero__trust" aria-label="Преимущества магазина">
                <span>
                  <BadgeCheck size={18} /> Каталог продуктов
                </span>
                <span>
                  <Building2 size={18} /> Для дома и кухни
                </span>
              </div>
            </div>

            <aside className="home-hero__panel" aria-label="Как собрать заказ продуктов">
              <div className="home-hero__panel-heading">
                <span>Продукты для вашего меню</span>
                <Boxes size={26} />
              </div>
              <h2>От выбора продуктов до заказа</h2>
              <ol className="home-hero__steps">
                <li>
                  <b>01</b>
                  <span>
                    <strong>Выбор продуктов</strong>
                    По вашему меню и списку закупок
                  </span>
                </li>
                <li>
                  <b>02</b>
                  <span>
                    <strong>Состав заказа</strong>
                    Проверьте позиции и нужное количество
                  </span>
                </li>
                <li>
                  <b>03</b>
                  <span>
                    <strong>Оформление заказа</strong>
                    Укажите контакты и способ получения
                  </span>
                </li>
              </ol>
              <div className="home-hero__panel-note">
                <ShieldCheck size={20} />
                <span>Вопросы по заказу можно уточнить по телефону</span>
              </div>
            </aside>
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="home-section__heading">
          <div className="home-section__heading-copy">
            <p>Категории</p>
            <h2>Основные направления</h2>
            <span>Овощи, фрукты, бакалея и ингредиенты для паназиатской кухни.</span>
          </div>
          <AppButton asChild variant="secondary">
            <Link to="/categories">
              Все категории
              <ArrowRight size={17} />
            </Link>
          </AppButton>
        </div>
        {categoriesQuery.isLoading ? (
          <div className="home-skeleton-grid">
            {Array.from({ length: 4 }, (_, index) => (
              <AppCard key={index}>
                <AppSkeleton />
              </AppCard>
            ))}
          </div>
        ) : categoriesQuery.isError ? (
          <StoreEmptyState
            title="Не удалось загрузить категории"
            description="Проверьте подключение к интернету и попробуйте ещё раз."
            tone="danger"
            onRetry={() => categoriesQuery.refetch()}
          />
        ) : featuredCategories.length > 0 ? (
          <div className="home-category-grid">
            {featuredCategories.map((category) => (
              <CategoryCard
                key={category.id ?? category.slug}
                category={category}
                count={productCounts[String(category.id ?? category.slug)] ?? 0}
              />
            ))}
          </div>
        ) : (
          <StoreEmptyState
            title="Категории пока не загружены"
            description="Список категорий появится после обновления каталога."
          />
        )}
      </section>

      <section className="home-section home-section--products">
        <div className="home-section__heading">
          <div className="home-section__heading-copy">
            <p>Товары</p>
            <h2>Продукты в каталоге</h2>
            <span>Выбирайте продукты по названию, цене и наличию.</span>
          </div>
          <AppButton asChild variant="secondary" className="home-section__desktop-action">
            <Link to="/catalog">
              Смотреть каталог
              <ArrowRight size={17} />
            </Link>
          </AppButton>
        </div>
        {productsQuery.isLoading ? (
          <div className="home-skeleton-grid home-skeleton-grid--products">
            {Array.from({ length: FEATURED_PRODUCTS_LIMIT }, (_, index) => (
              <AppCard key={index}>
                <AppSkeleton />
              </AppCard>
            ))}
          </div>
        ) : productsQuery.isError ? (
          <StoreEmptyState
            title="Не удалось загрузить товары"
            description="Проверьте подключение к интернету и попробуйте ещё раз."
            tone="danger"
            onRetry={() => productsQuery.refetch()}
          />
        ) : featuredProducts.length > 0 ? (
          <div className="home-featured-products">
            <ProductGrid products={featuredProducts.slice(0, FEATURED_PRODUCTS_LIMIT)} />
            <AppButton asChild variant="secondary" className="home-featured-products__more">
              <Link to="/catalog">
                Смотреть весь каталог
                <ArrowRight size={17} />
              </Link>
            </AppButton>
          </div>
        ) : (
          <StoreEmptyState
            title="Товары пока не загружены"
            description="Продукты появятся здесь после обновления каталога."
          />
        )}
      </section>

      {heroVariant === "default" && (
        <section
          className="home-section home-seo-directions"
          aria-labelledby="home-directions-title"
        >
          <div className="home-section__heading-copy">
            <p>Паназиатские продукты GastroFlow</p>
            <h2 id="home-directions-title">Продукты для вашего меню</h2>
            <span>
              В каталоге GastroFlow можно подобрать овощи, фрукты, бакалею и ингредиенты для
              паназиатских блюд. Уточняйте наличие и актуальные условия поставки перед заказом.
            </span>
          </div>
          <div className="home-seo-directions__grid">
            <article>
              <h3>Овощи и зелень</h3>
              <p>
                Овощи и зелень для салатов, гарниров и горячих блюд. Выбирайте позиции в каталоге и
                указывайте нужное количество.
              </p>
            </article>
            <article>
              <h3>Фрукты</h3>
              <p>
                Фрукты для десертов, напитков и свежей подачи. Актуальный ассортимент и цены
                доступны в каталоге.
              </p>
            </article>
            <article>
              <h3>Бакалея и паназиатские продукты</h3>
              <p>
                Ингредиенты для паназиатской кухни и повседневного меню. Ищите нужную позицию по
                названию или артикулу.
              </p>
            </article>
          </div>
        </section>
      )}

      <section
        className={heroVariant === "alternative" ? "home2-benefits" : "home-benefits"}
        aria-labelledby="home-benefits-title"
      >
        <div className="home-benefits__heading">
          <p>Покупки в GastroFlow</p>
          <h2 id="home-benefits-title">Перед оформлением заказа</h2>
          <span>Проверьте наличие, цены и условия получения продуктов.</span>
        </div>
        <div className="home-benefits__grid">
          {benefits.map(({ icon: Icon, title, text }, index) => (
            <article key={title} className="home-benefit-card">
              {heroVariant === "alternative" && (
                <span className="home2-benefits__number" aria-hidden="true">
                  0{index + 1}
                </span>
              )}
              <span className="home-benefit-card__icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-cta">
        <div className="home-cta__icon" aria-hidden="true">
          <Headphones size={28} />
        </div>
        <div className="home-cta__copy">
          <p>Есть вопросы по продуктам?</p>
          <h2>Свяжитесь с GastroFlow</h2>
          <span>Уточните ассортимент, наличие и условия заказа.</span>
        </div>
        <div className="home-cta__actions">
          <AppButton asChild>
            <a href="tel:+77774593233">Позвонить нам</a>
          </AppButton>
          <AppButton asChild variant="secondary">
            <Link to="/catalog">Открыть каталог</Link>
          </AppButton>
        </div>
      </section>

      <section className="home-reviews home-section">
        <div className="home-section__heading">
          <div className="home-section__heading-copy">
            <p>Отзывы</p>
            <h2>Что говорят клиенты</h2>
            <span>Отзывы покупателей о товарах и заказах.</span>
          </div>
          {reviewSummary && reviewSummary.totalReviews > 0 && (
            <div className="home-reviews__summary" aria-label="Средняя оценка магазина">
              <strong>{reviewSummary.averageRating.toFixed(1)}</strong>
              <span>
                <b>из 5</b>
                {reviewSummary.verifiedReviews} подтверждённых
              </span>
            </div>
          )}
        </div>
        <div className="home-reviews__grid">
          {reviewsQuery.isLoading ? (
            Array.from({ length: 3 }, (_, index) => (
              <AppCard key={index} className="home-review-card home-review-card--loading">
                <AppSkeleton />
              </AppCard>
            ))
          ) : reviewsQuery.isError ? (
            <StoreEmptyState
              title="Не удалось загрузить отзывы"
              description="Не удалось получить отзывы. Попробуйте ещё раз позже."
              tone="danger"
              onRetry={() => reviewsQuery.refetch()}
            />
          ) : latestReviews.length > 0 ? (
            latestReviews.map((review) => (
              <AppCard key={review.id} className="home-review-card">
                <div className="home-review-card__topline">
                  <div
                    className="home-review-card__stars"
                    aria-label={`Оценка ${review.rating} из 5`}
                  >
                    {"★".repeat(review.rating)}
                  </div>
                  <Quote size={22} aria-hidden="true" />
                </div>
                <p>{review.content}</p>
                {review.images[0] && (
                  <img
                    className="home-review-card__image"
                    src={`${API_URL}${review.images[0].filePath}`}
                    alt={review.images[0].originalFileName}
                    loading="lazy"
                    decoding="async"
                  />
                )}
                <div className="home-review-card__person">
                  <strong>{review.authorName}</strong>
                  <span>{review.productName}</span>
                </div>
                {review.verified && <AppBadge tone="green">Подтверждённый</AppBadge>}
              </AppCard>
            ))
          ) : (
            <StoreEmptyState
              title="Отзывы скоро появятся"
              description="Здесь появятся отзывы покупателей о товарах и заказах."
            />
          )}
        </div>
      </section>
    </StoreLayout>
  );
}
