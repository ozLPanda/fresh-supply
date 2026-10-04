export const ALMATY_TIME_ZONE = "Asia/Almaty";

type DateValue = string | number | Date | null | undefined;

function toValidDate(value: DateValue) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(
  value: DateValue,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
) {
  const date = toValidDate(value);
  if (!date) return "—";

  return new Intl.DateTimeFormat("ru-KZ", {
    timeZone: ALMATY_TIME_ZONE,
    ...options,
  }).format(date);
}

export function todayInAlmaty() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ALMATY_TIME_ZONE }).format(new Date());
}

export function timeInAlmaty() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ALMATY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}
