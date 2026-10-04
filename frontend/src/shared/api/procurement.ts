import { api } from "@/shared/api/http";
import type {
  ProcurementCompany,
  ProcurementCompanyInput,
  ProcurementCompanyNote,
  ProcurementFile,
  ProcurementPayment,
  ProcurementPaymentInput,
  ProcurementProject,
  ProcurementProjectInput,
  ProcurementProjectSummary,
  ProcurementStatus,
  ProcurementStatusHistory,
} from "@/shared/types/procurement";
import type { PagedResult } from "@/shared/types/models";

const ROOT = "/api/admin/procurement";

export function fetchProcurementProjects(
  params: { status?: ProcurementStatus; search?: string; page?: number; size?: number } = {},
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  query.set("page", String(params.page ?? 1));
  query.set("size", String(params.size ?? 100));
  return api<PagedResult<ProcurementProjectSummary>>(`${ROOT}?${query}`);
}

export function fetchProcurementProject(id: number) {
  return api<ProcurementProject>(`${ROOT}/${id}`);
}

export function createProcurementProject(input: ProcurementProjectInput) {
  return api<ProcurementProject>(ROOT, { method: "POST", body: JSON.stringify(input) });
}

export function updateProcurementProject(id: number, input: ProcurementProjectInput) {
  return api<ProcurementProject>(`${ROOT}/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function changeProcurementStatus(id: number, status: ProcurementStatus, comment?: string) {
  return api<ProcurementProject>(`${ROOT}/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, comment: comment?.trim() || null }),
  });
}

export function fetchProcurementStatusHistory(id: number) {
  return api<ProcurementStatusHistory[]>(`${ROOT}/${id}/status-history`);
}

export function createProcurementCompany(projectId: number, input: ProcurementCompanyInput) {
  return api<ProcurementCompany>(`${ROOT}/${projectId}/companies`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProcurementCompany(
  projectId: number,
  companyId: number,
  input: ProcurementCompanyInput,
) {
  return api<ProcurementCompany>(`${ROOT}/${projectId}/companies/${companyId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteProcurementCompany(projectId: number, companyId: number) {
  return api<void>(`${ROOT}/${projectId}/companies/${companyId}`, { method: "DELETE" });
}

export function fetchProcurementCompanyNotes(projectId: number, companyId: number) {
  return api<ProcurementCompanyNote[]>(`${ROOT}/${projectId}/companies/${companyId}/notes`);
}

export function addProcurementCompanyNote(projectId: number, companyId: number, content: string) {
  return api<ProcurementCompanyNote>(`${ROOT}/${projectId}/companies/${companyId}/notes`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function updateProcurementCompanyNote(
  projectId: number,
  companyId: number,
  noteId: number,
  content: string,
) {
  return api<ProcurementCompanyNote>(
    `${ROOT}/${projectId}/companies/${companyId}/notes/${noteId}`,
    {
      method: "PUT",
      body: JSON.stringify({ content }),
    },
  );
}

export function deleteProcurementCompanyNote(projectId: number, companyId: number, noteId: number) {
  return api<void>(`${ROOT}/${projectId}/companies/${companyId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

export function uploadProcurementFile(
  projectId: number,
  file: File,
  displayName: string,
  companyId?: number,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("displayName", displayName);
  return api<ProcurementFile>(
    companyId ? `${ROOT}/${projectId}/companies/${companyId}/files` : `${ROOT}/${projectId}/files`,
    { method: "POST", body: form },
  );
}

export function deleteProcurementFile(projectId: number, fileId: number) {
  return api<void>(`${ROOT}/${projectId}/files/${fileId}`, { method: "DELETE" });
}

export function updateProcurementTextFile(projectId: number, fileId: number, text: string) {
  return api<ProcurementFile>(`${ROOT}/${projectId}/files/${fileId}/text`, {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
}

export function createProcurementPayment(projectId: number, input: ProcurementPaymentInput) {
  return api<ProcurementPayment>(`${ROOT}/${projectId}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProcurementPayment(
  projectId: number,
  paymentId: number,
  input: ProcurementPaymentInput,
) {
  return api<ProcurementPayment>(`${ROOT}/${projectId}/payments/${paymentId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteProcurementPayment(projectId: number, paymentId: number) {
  return api<void>(`${ROOT}/${projectId}/payments/${paymentId}`, { method: "DELETE" });
}
