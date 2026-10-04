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
    title: "Доставка по Казахстану",
    text: "Быстро передаём оборудование в отгрузку и помогаем с логистикой.",
  },
  {
    icon: Headphones,
    title: "Помощь специалистов",
    text: "Проверим мощность, совместимость и состав комплектации до заказа.",
  },
  {
    icon: WalletCards,
    title: "Оптовые условия",
    text: "Предлагаем понятную коммерческую цену для частных и B2B-заказов.",
  },
  {
    icon: PackageCheck,
    title: "Актуальное наличие",
    text: "Покажем статус товара и предложим подходящую замену при необходимости.",
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
        title="Фирма «Актив» — отопление, водоснабжение и сантехника"
        description="Каталог товаров для отопления, водоснабжения и сантехники: котлы, насосы, радиаторы и комплектующие. Цены и заказ онлайн."
        canonicalPath="/"
        structuredData={{
          "@context": "https://schema.org",
          "@type": ["OnlineStore", "LocalBusiness"],
          name: "Фирма «Актив»",
          url: window.location.origin,
          logo: `${window.location.origin}/pwa-512x512.png`,
          telephone: "+7 777 459 32 33",
          email: "toofirmaaktiv@mail.ru",
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
              <AppBadge tone="orange">Отопление • Сантехника</AppBadge>
              <h1>
                Инженерные решения <span>для вашего объекта</span>
              </h1>
              <p>
                Котлы, насосы, радиаторы и комплектующие с профессиональным подбором. Помогаем
                быстро собрать совместимую систему для дома, бизнеса или промышленного объекта.
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
                <span>Подберём товар даже при опечатке — на русском или казахском.</span>
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
                  <BadgeCheck size={18} /> Проверенные решения
                </span>
                <span>
                  <Building2 size={18} /> Для дома и бизнеса
                </span>
              </div>
            </div>

            <aside className="home-hero__panel" aria-label="Этапы комплектации объекта">
              <div className="home-hero__panel-heading">
                <span>Комплектация под задачу</span>
                <Boxes size={26} />
              </div>
              <h2>От спецификации до готовой поставки</h2>
              <ol className="home-hero__steps">
                <li>
                  <b>01</b>
                  <span>
                    <strong>Подбор оборудования</strong>
                    По параметрам объекта и бюджету
                  </span>
                </li>
                <li>
                  <b>02</b>
                  <span>
                    <strong>Проверка совместимости</strong>
                    Чтобы все элементы работали вместе
                  </span>
                </li>
                <li>
                  <b>03</b>
                  <span>
                    <strong>Комплектация и отгрузка</strong>
                    Один заказ вместо десятка поставщиков
                  </span>
                </li>
              </ol>
              <div className="home-hero__panel-note">
                <ShieldCheck size={20} />
                <span>Поддержка специалиста на каждом этапе</span>
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
            <span>Быстрый переход к оборудованию для ключевых инженерных систем.</span>
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
            description="Проверьте соединение с API и повторите загрузку списка категорий."
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
            description="Добавьте категории в админке, и они появятся здесь автоматически."
          />
        )}
      </section>

      <section className="home-section home-section--products">
        <div className="home-section__heading">
          <div className="home-section__heading-copy">
            <p>Товары</p>
            <h2>Товары для инженерных задач</h2>
            <span>Актуальные позиции каталога с ценами, наличием и характеристиками.</span>
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
            description="Проверьте соединение с API и повторите загрузку списка товаров."
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
            description="Когда товары появятся в API, витрина автоматически покажет их в этой секции."
          />
        )}
      </section>

      {heroVariant === "default" && (
        <section
          className="home-section home-seo-directions"
          aria-labelledby="home-directions-title"
        >
          <div className="home-section__heading-copy">
            <p>Отопление и сантехника в Павлодаре</p>
            <h2 id="home-directions-title">Оборудование для дома, бизнеса и монтажа</h2>
            <span>
              В каталоге Фирмы «Актив» можно подобрать оборудование для отопления, водоснабжения и
              инженерных систем. Уточняем совместимость, комплектацию и актуальные условия поставки
              перед заказом.
            </span>
          </div>
          <div className="home-seo-directions__grid">
            <article>
              <h3>Отопительное оборудование</h3>
              <p>
                Котлы длительного горения, радиаторы биметаллические и алюминиевые, автоматика для
                котлов, вентиляторы, ИБП и бесперебойники для стабильной работы системы.
              </p>
            </article>
            <article>
              <h3>Дымоходы и вентиляция</h3>
              <p>
                Дымоходы, сэндвич-дымоходы и сэндвич-трубы для безопасного отвода продуктов сгорания
                и монтажа отопительного оборудования.
              </p>
            </article>
            <article>
              <h3>Трубы, краны и комплектующие</h3>
              <p>
                Полипропиленовые трубы, трубы, краны, сгоны и другие фитинги для систем отопления и
                водоснабжения. Ищите нужную позицию по названию или артикулу.
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
          <p>Почему мы</p>
          <h2 id="home-benefits-title">Поставка, на которую можно опереться</h2>
          <span>Берём на себя детали, чтобы вы сосредоточились на своём объекте.</span>
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
          <p>Нужна помощь с комплектацией?</p>
          <h2>Обсудите задачу со специалистом</h2>
          <span>Подскажем по мощности, совместимости и составу заказа.</span>
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
            <span>Опыт покупателей, которые уже выбрали оборудование для своих объектов.</span>
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
              description="Повторите попытку — возможно, соединение с API временно недоступно."
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
              description="Когда клиенты оставят отзывы и администратор их подтвердит, они появятся здесь."
            />
          )}
        </div>
      </section>
    </StoreLayout>
  );
}
