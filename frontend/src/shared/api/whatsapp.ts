import { api } from "@/shared/api/http";

export type WhatsAppContact = {
  id: number;
  waId: string;
  displayName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
};

export type WhatsAppMessage = {
  id: number;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  occurredAt: string;
  status: string | null;
};

export type WhatsAppPage<T> = {
  items: T[];
  total: number;
  page: number;
  size: number;
};

export type WhatsAppStatus = {
  configured: boolean;
  phoneNumberId: string | null;
};

export function fetchWhatsAppStatus() {
  return api<WhatsAppStatus>("/api/admin/whatsapp/status");
}

export function fetchWhatsAppContacts(query: string, page = 0, size = 30) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (query.trim()) params.set("query", query.trim());
  return api<WhatsAppPage<WhatsAppContact>>(`/api/admin/whatsapp/contacts?${params}`);
}

export function fetchWhatsAppMessages(contactId: number, page = 0, size = 50) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  return api<WhatsAppPage<WhatsAppMessage>>(
    `/api/admin/whatsapp/contacts/${contactId}/messages?${params}`,
  );
}
