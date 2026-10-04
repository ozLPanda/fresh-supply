import { X } from "lucide-react";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import "./ActiveFilterTags.css";

export type ActiveFilterTag = {
  id: string;
  label: string;
  onRemove: () => void;
};

export function ActiveFilterTags({
  tags,
  onReset,
}: {
  tags: ActiveFilterTag[];
  onReset: () => void;
}) {
  if (tags.length === 0) return null;

  return (
    <div className="active-filter-tags">
      <span>Выбрано:</span>
      <div className="active-filter-tags__list">
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="active-filter-tags__tag"
            title={tag.label}
            onClick={tag.onRemove}
          >
            <AppBadge tone="orange">{tag.label}</AppBadge>
            <X size={14} />
          </button>
        ))}
        <AppButton
          type="button"
          variant="ghost"
          className="active-filter-tags__reset"
          onClick={onReset}
        >
          Очистить всё
        </AppButton>
      </div>
    </div>
  );
}
