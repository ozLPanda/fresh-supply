import { api } from "@/shared/api/http";
import type {
  BarcodeOrderPriceTier,
  BarcodeOrderProduct,
  CreateBarcodeOrderRequest,
  CreatedBarcodeOrder,
} from "@/shared/api/barcodeOrders";
import type { MeasurementUnit } from "@/shared/types/models";

export type OrderAssistantContext = {
  mode: "CREATE" | "DRAFT";
  priceTier: BarcodeOrderPriceTier;
  orderDate: string;
  regularBuyerId?: string | null;
  customerId?: number | null;
  pendingCustomerEmail?: string | null;
  pendingCustomerPhone?: string | null;
  comment?: string | null;
  items?: Array<{
    productId: number;
    quantity: number;
    measurementUnit?: MeasurementUnit;
    unitPrice?: number | null;
  }>;
};
export type OrderAssistantItem = {
  source: string;
  productId: number | null;
  name: string;
  quantity: number | null;
  measurementUnit: MeasurementUnit | null;
  unitPrice: number | null;
  issue?: string | null;
  product?: BarcodeOrderProduct | null;
};
export type OrderAssistantClarification = {
  id: string;
  kind: "BUYER" | "CHOICE";
  question: string;
  options: Array<{ id: string; label: string }>;
};
export type OrderAssistantPhoto = { id: string; number: number; name: string; dataUrl: string };
export type OrderAssistantSession = {
  attachments?: OrderAssistantPhoto[];
  id: string;
  mode: "CREATE" | "DRAFT";
  revision: number;
  appliedRevision: number | null;
  orderId: string | null;
  priceTier: BarcodeOrderPriceTier;
  orderDate: string;
  messages: Array<{ role: string; content: string }>;
  proposal: {
    regularBuyerId: string | null;
    regularBuyerName: string | null;
    supplierId: string | null;
    supplierName: string | null;
    customerId: number | null;
    pendingCustomerEmail: string | null;
    pendingCustomerPhone: string | null;
    comment: string | null;
    items: OrderAssistantItem[];
    questions: string[];
    clarifications?: OrderAssistantClarification[];
  };
  ready: boolean;
};
const base = "/api/admin/order-assistant/sessions";
export const createOrderAssistantSession = (context: OrderAssistantContext) =>
  api<OrderAssistantSession>(base, { method: "POST", body: JSON.stringify(context) });
export const getOrderAssistantSession = (id: string) =>
  api<OrderAssistantSession>(`${base}/${encodeURIComponent(id)}`);
export const sendOrderAssistantMessage = (
  id: string,
  message: string,
  revision: number,
  attachments: Array<{ name: string; dataUrl: string }> = [],
) =>
  api<OrderAssistantSession>(`${base}/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ message, revision, attachments }),
  });
export const applyOrderAssistant = (id: string, revision: number, allowStockShortage = false) =>
  api<OrderAssistantSession>(`${base}/${encodeURIComponent(id)}/apply`, {
    method: "POST",
    body: JSON.stringify({ revision, allowStockShortage }),
  });

export const answerOrderAssistantQuestion = (id: string, answerId: string, revision: number) =>
  api<OrderAssistantSession>(`${base}/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ revision, answerId }),
  });
export const selectOrderAssistantBuyer = (
  id: string,
  regularBuyerId: string | null,
  revision: number,
) =>
  api<OrderAssistantSession>(`${base}/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ revision, selectBuyer: true, regularBuyerId }),
  });

export const checkoutOrderAssistant = (
  id: string,
  revision: number,
  order: CreateBarcodeOrderRequest,
) =>
  api<CreatedBarcodeOrder>(`${base}/${encodeURIComponent(id)}/checkout`, {
    method: "POST",
    body: JSON.stringify({ revision, order }),
  });

export const updateOrderAssistantItems = (
  id: string,
  revision: number,
  items: OrderAssistantItem[],
) =>
  api<OrderAssistantSession>(`${base}/${encodeURIComponent(id)}/items`, {
    method: "PATCH",
    body: JSON.stringify({ revision, items: items.map(({ product: _product, ...item }) => item) }),
  });
