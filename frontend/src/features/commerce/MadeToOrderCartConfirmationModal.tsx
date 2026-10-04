import { Product } from "@/shared/types/models";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCheckbox } from "@/shared/ui/AppControls";
import { AppModal } from "@/shared/ui/AppFeedback";
import "./MadeToOrderCartConfirmationModal.css";

export function MadeToOrderCartConfirmationModal({
  product,
  rememberChoice,
  submitting,
  onOpenChange,
  onRememberChoiceChange,
  onCancel,
  onConfirm,
}: {
  product: Product | null;
  rememberChoice: boolean;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onRememberChoiceChange: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AppModal
      open={product !== null}
      onOpenChange={onOpenChange}
      title="Товар доступен под заказ"
      description={
        product
          ? `«${product.nameRu}» поставляется под заказ. Перед оформлением мы подтвердим наличие и срок поставки.`
          : undefined
      }
      contentClassName="made-to-order-cart-confirmation"
    >
      <div className="made-to-order-cart-confirmation__content">
        <p>
          Товар может отсутствовать у поставщика. Если его не будет в наличии, магазин свяжется с
          вами, чтобы предложить замену или изменить состав заказа.
        </p>
        <AppCheckbox
          label="Больше не показывать"
          description="В дальнейшем товары под заказ будут сразу добавляться в корзину на этом устройстве."
          checked={rememberChoice}
          disabled={submitting}
          onCheckedChange={onRememberChoiceChange}
        />
        <div className="made-to-order-cart-confirmation__actions">
          <AppButton type="button" variant="secondary" disabled={submitting} onClick={onCancel}>
            Отмена
          </AppButton>
          <AppButton type="button" loading={submitting} onClick={onConfirm}>
            Добавить в корзину
          </AppButton>
        </div>
      </div>
    </AppModal>
  );
}
