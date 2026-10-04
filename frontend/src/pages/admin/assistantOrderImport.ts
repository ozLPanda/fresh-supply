import type { OrderAssistantSession } from "@/shared/api/orderAssistant";
import type { AssistantDraftReview, BarcodeOrderLine } from "./barcodeOrderDraft";
import { MAX_ORDER_QUANTITY, MIN_ORDER_QUANTITY } from "@/features/orders/OrderQuantityInput";

export function prepareAssistantOrderImport(session: OrderAssistantSession) {
  const lines: BarcodeOrderLine[] = [];
  const unresolved: AssistantDraftReview["unresolved"] = [];
  const productCounts = new Map<number, number>();
  session.proposal.items.forEach((item) => {
    if (item.productId)
      productCounts.set(item.productId, (productCounts.get(item.productId) ?? 0) + 1);
  });
  for (const item of session.proposal.items) {
    let reason = item.issue?.trim() || "";
    if (!item.product || !item.productId || item.product.id !== item.productId)
      reason ||= "Товар не определён: подберите его вручную.";
    if (
      item.quantity == null ||
      !Number.isFinite(item.quantity) ||
      item.quantity < MIN_ORDER_QUANTITY ||
      item.quantity > MAX_ORDER_QUANTITY ||
      Math.abs(item.quantity * 1000 - Math.round(item.quantity * 1000)) > 0.000001
    )
      reason ||= "Уточните количество: нужно от 0,001 до 999, не больше трёх знаков после запятой.";
    if (item.unitPrice == null || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)
      reason ||= "Не определена корректная цена.";
    if (
      !item.measurementUnit ||
      !["KG", "PIECE"].includes(item.measurementUnit) ||
      item.measurementUnit !== item.product?.measurementUnit
    )
      reason ||= "Единица заявки не совпадает с каталогом. Уточните количество и единицу вручную.";
    if (item.productId && (productCounts.get(item.productId) ?? 0) > 1)
      reason ||= "Товар повторяется в заявке. Проверьте и объедините его количество вручную.";
    if (
      reason ||
      !item.product ||
      item.quantity == null ||
      item.unitPrice == null ||
      !item.measurementUnit
    ) {
      unresolved.push({
        source: item.source,
        name: item.name,
        quantity: item.quantity,
        unit: item.measurementUnit,
        reason,
      });
    } else {
      lines.push({
        ...item.product,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        measurementUnit: item.measurementUnit,
      });
    }
  }
  const questions = [
    ...new Set([
      ...session.proposal.questions,
      ...(session.proposal.clarifications ?? []).map((question) => question.question),
    ]),
  ];
  const review: AssistantDraftReview = {
    sessionId: session.id,
    revision: session.revision,
    unresolved,
    questions,
    reviewed: false,
  };
  return { lines, review };
}
