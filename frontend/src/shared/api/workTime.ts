import { api } from "./http";
export type WorkInterval = { start: number; end: number };
export type WorkAdditionalPayment = { title: string; amount: number };
export type WorkSettings = { dailyRate: number; normMinutes: number; version: number };
export type WorkDay = {
  id: number;
  date: string;
  dailyRate: number;
  normMinutes: number;
  minutes: number;
  amount: number;
  note: string;
  version: number;
  paymentId: number | null;
  intervals: WorkInterval[];
  additionalPayments: WorkAdditionalPayment[];
};
export type WorkPayment = {
  id: number;
  from: string;
  to: string;
  paidOn: string;
  amount: number;
  note: string;
  createdBy: string;
  cancelledAt: string | null;
  cancelReason: string | null;
};
export type WorkTransaction = {
  id: number;
  occurredOn: string;
  amount: number;
  note: string;
  createdBy: string;
  cancelledAt: string | null;
  cancelReason: string | null;
};
export type WorkView = {
  userId: number;
  name: string;
  canManage: boolean;
  settings: WorkSettings;
  days: WorkDay[];
  payments: WorkPayment[];
  transactions: WorkTransaction[];
  balance: {
    amount: number;
    days: number;
    minutes: number;
    firstUnpaid: string | null;
    lastMarked: string | null;
    unpricedDays: number;
  };
};
export const workEmployees = () =>
  api<{ id: number; name: string }[]>("/api/admin/work-time/employees");
export const workView = (id: number, from: string, to: string) =>
  api<WorkView>(`/api/admin/work-time/${id}?${new URLSearchParams({ from, to })}`);
export const workWrite = (id: number, path: string, body: unknown, method = "POST") =>
  api<void>(`/api/admin/work-time/${id}/${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
