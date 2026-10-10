import { useState } from "react";
import { type Product } from "@/shared/types/models";
import { AppModal } from "@/shared/ui/AppFeedback";
import { ProductEditor } from "./ProductEditor";
import "./ProductCreateModal.css";

export function ProductCreateModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: Product) => void;
}) {
  const [saving, setSaving] = useState(false);

  return (
    <AppModal
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
      title="Создание товара"
      description="После сохранения вы вернётесь к подбору товаров."
      contentClassName="product-create-modal"
    >
      {open && (
        <ProductEditor
          embedded
          onSavingChange={setSaving}
          onSaved={(product) => {
            setSaving(false);
            onCreated(product);
            onOpenChange(false);
          }}
        />
      )}
    </AppModal>
  );
}
