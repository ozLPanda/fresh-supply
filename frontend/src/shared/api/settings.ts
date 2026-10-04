import { api } from "@/shared/api/http";

export type ProjectSettings = {
  searchAiEnabled: boolean;
  embeddingsConfigured: boolean;
  wholesaleMinQuantity: number;
  priceImportExcludedNameTerms: string[];
};

export type ProjectSettingsUpdate = {
  searchAiEnabled: boolean;
  wholesaleMinQuantity: number;
  priceImportExcludedNameTerms: string[];
};

export type StoreSettings = {
  wholesaleMinQuantity: number;
};

export type PaymentInvoiceSettings = {
  supplierName: string;
  supplierTaxId: string;
  bankName: string;
  iban: string;
  bic: string;
  beneficiaryCode: string;
  paymentPurposeCode: string;
  contract: string;
  executor: string;
  paymentTerms: string;
};

export function fetchPaymentInvoiceSettings() {
  return api<PaymentInvoiceSettings>("/api/admin/settings/payment-invoice");
}

export function updatePaymentInvoiceSettings(payload: PaymentInvoiceSettings) {
  return api<PaymentInvoiceSettings>("/api/admin/settings/payment-invoice", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchProjectSettings() {
  return api<ProjectSettings>("/api/admin/settings");
}

export function updateProjectSettings(payload: ProjectSettingsUpdate) {
  return api<ProjectSettings>("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchStoreSettings() {
  return api<StoreSettings>("/api/settings/store");
}
