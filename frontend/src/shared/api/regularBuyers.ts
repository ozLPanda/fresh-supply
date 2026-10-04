import { api } from "@/shared/api/http";

export type RegularBuyer = {
  aliases: string[];
  id: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  legalAddress?: string | null;
  comment?: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RegularBuyerInput = {
  aliases?: string[];
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  legalAddress?: string | null;
  comment?: string | null;
  archived?: boolean;
};

export function fetchRegularBuyers(includeArchived = false) {
  return api<RegularBuyer[]>(
    `/api/admin/regular-buyers${includeArchived ? "?includeArchived=true" : ""}`,
  );
}

export function createRegularBuyer(input: RegularBuyerInput) {
  return api<RegularBuyer>("/api/admin/regular-buyers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateRegularBuyer(id: string, input: RegularBuyerInput) {
  return api<RegularBuyer>(`/api/admin/regular-buyers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
