import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Pencil } from "lucide-react";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppModal } from "@/shared/ui/AppFeedback";
import { Category } from "@/shared/types/models";
import { categoryImageUrl } from "@/shared/images/imageCache";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { getCategoryCountLabel, getCategoryImage } from "./store-utils";
import { CategoryFormPage } from "@/pages/admin/CategoryFormPage";
import "./CategoryCard.css";

function CategoryFallback({ title }: { title: string }) {
  return <span className="category-card__fallback">{title.slice(0, 1).toUpperCase()}</span>;
}

export function CategoryCard({ category, count = 0 }: { category: Category; count?: number }) {
  const { user } = useCommerce();
  const [cardCategory, setCardCategory] = useState(category);
  const [editing, setEditing] = useState(false);
  const imagePath = getCategoryImage(cardCategory);
  const imageSrc = categoryImageUrl(cardCategory);
  const title =
    cardCategory.nameRu?.trim() ||
    cardCategory.nameKk?.trim() ||
    cardCategory.slug?.trim() ||
    "Категория";
  const description =
    cardCategory.descriptionRu?.trim() || "Продукты этой категории в каталоге GastroFlow.";
  const href = cardCategory.slug ? `/catalog/${cardCategory.slug}` : "/catalog";
  const canEdit =
    Boolean(cardCategory.id) && (user?.permissions?.includes("categories.update") ?? false);

  useEffect(() => setCardCategory(category), [category]);

  return (
    <article className="category-card">
      {canEdit && (
        <button
          type="button"
          className="category-card__edit"
          onClick={() => setEditing(true)}
          aria-label={`Редактировать категорию «${title}»`}
          title="Редактировать категорию"
        >
          <Pencil size={16} aria-hidden="true" />
        </button>
      )}
      <Link className="category-card__content" to={href}>
        <div className="category-card__media">
          {imagePath ? (
            <img src={imageSrc ?? ""} alt={title} loading="lazy" decoding="async" />
          ) : (
            <CategoryFallback title={title} />
          )}
        </div>
        <div className="category-card__body">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <div className="category-card__footer">
            <AppBadge tone="slate">{getCategoryCountLabel(count)}</AppBadge>
            <span className="category-card__link">
              В каталог
              <ChevronRight size={16} />
            </span>
          </div>
        </div>
      </Link>
      {canEdit && cardCategory.id && (
        <AppModal
          open={editing}
          onOpenChange={setEditing}
          title="Редактирование категории"
          contentClassName="category-card__edit-modal"
        >
          <CategoryFormPage
            embedded
            categoryId={cardCategory.id}
            onSaved={(savedCategory) => {
              setCardCategory(savedCategory);
              setEditing(false);
            }}
          />
        </AppModal>
      )}
    </article>
  );
}
