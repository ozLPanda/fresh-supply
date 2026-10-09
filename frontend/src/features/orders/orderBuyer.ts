import type { Order } from "@/shared/types/models";

/** The buyer snapshot identifies the recipient independently of the customer account. */
export function getOrderBuyerName(order: Pick<Order, "regularBuyerName" | "customerName">) {
  return order.regularBuyerName?.trim() || order.customerName?.trim() || null;
}
