import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Category } from "@/shared/types/models";
import { categoryImageUrl } from "@/shared/images/imageCache";
import { getCategoryImage } from "./store-utils";
import "./PromoCategoryCard.css";

export function PromoCategoryCard({
  category,
  compact = false,
}: {
  category: Category;
  compact?: boolean;
}) {
  const imagePath = getCategoryImage(category);
  const imageSrc = categoryImageUrl(category);
  const title =
    category.nameRu?.trim() || category.nameKk?.trim() || category.slug?.trim() || "Категория";
  const description = category.descriptionRu?.trim() || "Подборка инженерных решений по категории.";
  const href = category.slug ? `/catalog/${category.slug}` : "/catalog";

  return (
    <Link className={`promo-category-card ${compact ? "is-compact" : ""}`} to={href}>
      {imagePath ? (
        <img src={imageSrc ?? ""} alt={title} loading="lazy" decoding="async" />
      ) : (
        <div className="promo-category-card__fallback" aria-hidden="true" />
      )}
      <div className="promo-category-card__overlay" />
      <div className="promo-category-card__content">
        <h3>{title}</h3>
        <p>{description}</p>
        <span>
          Смотреть категорию
          <ChevronRight size={16} />
        </span>
      </div>
    </Link>
  );
}
