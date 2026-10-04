import { ApiResponse } from "@/shared/types/models";

// Development and production use the same-origin gateway. Vite proxies locally.
const DEFAULT_API_URL =
  typeof window === "undefined" ? "http://localhost:8084" : window.location.origin;

export const API_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

if (typeof window !== "undefined") {
  window.localStorage.removeItem("company_shop_token");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const json = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !json.success) {
    throw new ApiError(json.message || "Ошибка API", response.status);
  }
  return json.data;
}
