import { api } from "@/shared/api/http";

export const ONE_C_ORDER_READ_PERMISSION = "orders.read" as const;

export type OneCIntegrationPermission = typeof ONE_C_ORDER_READ_PERMISSION;

export type OneCIntegrationCredential = {
  id: string;
  name: string;
  token: string;
  permissions: OneCIntegrationPermission[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type SaveOneCIntegrationCredentialRequest = {
  name: string;
  permissions: OneCIntegrationPermission[];
  expiresAt: string | null;
};

const credentialsPath = "/api/admin/integrations/1c/credentials";

export function fetchOneCIntegrationCredentials() {
  return api<OneCIntegrationCredential[]>(credentialsPath);
}

export function createOneCIntegrationCredential(payload: SaveOneCIntegrationCredentialRequest) {
  return api<OneCIntegrationCredential>(credentialsPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateOneCIntegrationCredential(
  id: string,
  payload: SaveOneCIntegrationCredentialRequest,
) {
  return api<OneCIntegrationCredential>(`${credentialsPath}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function revokeOneCIntegrationCredential(id: string) {
  return api<OneCIntegrationCredential>(`${credentialsPath}/${id}/revoke`, { method: "POST" });
}
