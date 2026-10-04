import { api } from "@/shared/api/http";
import type { Order } from "@/shared/types/models";

export type BarcodeOrderPriceTier = "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO";

export type BarcodeOrderProduct = {
  id: number;
  sku: string;
  name: string;
  mainImageUrl: string | null;
  madeToOrder: boolean;
  retailPrice: number;
  wholesalePrice: number | null;
  bulkWholesalePrice: number | null;
  skoPrice: number | null;
};

export type BarcodeOrderCustomer = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
};

export type CreateBarcodeOrderRequest = {
  customerId: number | null;
  pendingCustomerEmail: string | null;
  pendingCustomerPhone: string | null;
  priceTier: BarcodeOrderPriceTier;
  orderDate: string;
  items: Array<{ productId: number; quantity: number; unitPrice: number }>;
  comment: string | null;
  allowStockShortage?: boolean;
};

export type CreatedBarcodeOrder = Order & {
  priceTier: BarcodeOrderPriceTier;
};

export function findBarcodeOrderProduct(
  code: string,
  priceTier: BarcodeOrderPriceTier,
  orderDate: string,
) {
  return api<BarcodeOrderProduct>(
    `/api/admin/barcode-orders/products/${encodeURIComponent(code.trim())}?${new URLSearchParams({ priceTier, orderDate })}`,
  );
}

export function getBarcodeOrderCustomers() {
  return api<BarcodeOrderCustomer[]>("/api/admin/barcode-orders/customers");
}

export function createBarcodeOrder(payload: CreateBarcodeOrderRequest) {
  return api<CreatedBarcodeOrder>("/api/admin/barcode-orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
