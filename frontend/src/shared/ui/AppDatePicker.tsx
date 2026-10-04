import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { format, isValid, parse } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import "./AppDatePicker.css";

export type AppDateRange = DateRange;

function CalendarPopover({ children }: { children: ReactNode }) {
  const [viewport, setViewport] = useState(() => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    width: window.visualViewport?.width ?? window.innerWidth,
  }));

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const syncViewport = () =>
      setViewport({
        height: visualViewport?.height ?? window.innerHeight,
        width: visualViewport?.width ?? window.innerWidth,
      });
    syncViewport();
    window.addEventListener("resize", syncViewport);
    visualViewport?.addEventListener("resize", syncViewport);
    visualViewport?.addEventListener("scroll", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
      visualViewport?.removeEventListener("resize", syncViewport);
      visualViewport?.removeEventListener("scroll", syncViewport);
    };
  }, []);

  return (
    <PopoverContent
      className="app-calendar-popover"
      align="start"
      collisionPadding={12}
      updatePositionStrategy="always"
      style={{
        maxHeight: `min(var(--radix-popover-content-available-height, ${viewport.height}px), ${Math.max(0, viewport.height - 24)}px)`,
        maxWidth: Math.max(0, viewport.width - 24),
      }}
    >
      {children}
    </PopoverContent>
  );
}

function formatDate(value?: Date) {
  return value ? format(value, "dd.MM.yyyy", { locale: ru }) : "";
}

function formatDateTime(value?: Date) {
  return value ? `${formatDate(value)} ${format(value, "HH:mm")}` : "";
}

function parseDate(value: string) {
  const normalized = value.trim().replace(/[/-]/g, ".");
  const parsed = parse(normalized, "d.M.yyyy", new Date());
  return isValid(parsed) ? parsed : undefined;
}

function parseDateTime(value: string) {
  const normalized = value.trim().replace(/[/-]/g, ".");
  if (!/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(normalized)) return undefined;
  const parsed = parse(normalized, "dd.MM.yyyy HH:mm", new Date());
  return isValid(parsed) && format(parsed, "dd.MM.yyyy HH:mm") === normalized ? parsed : undefined;
}

function extractDates(value: string) {
  return value.match(/\d{1,2}[./-]\d{1,2}[./-]\d{4}/g) ?? [];
}

function applyDateMask(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

function applyDateRangeMask(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  const from = applyDateMask(digits.slice(0, 8));
  const to = applyDateMask(digits.slice(8));

  if (digits.length < 8) return from;
  if (digits.length === 8) return `${from} — `;
  return `${from} — ${to}`;
}

function applyDateTimeMask(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  const date = applyDateMask(digits.slice(0, 8));
  const time = digits.slice(8);
  if (time.length === 0) return date;
  if (time.length <= 2) return `${date} ${time}`;
  return `${date} ${time.slice(0, 2)}:${time.slice(2)}`;
}

function DateField({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`app-date-field ${error ? "app-date-field--error" : ""}`}>
      {label && (
        <label className="app-date-field__label" htmlFor={id}>
          {label}
          {required && <b>*</b>}
        </label>
      )}
      {children}
      {(error || hint) && (
        <small className="app-date-field__message" role={error ? "alert" : undefined}>
          {error || hint}
        </small>
      )}
    </div>
  );
}

export function AppDatePicker({
  value,
  onValueChange,
  label,
  hint,
  error,
  required,
  placeholder = "Выберите дату",
  disabled,
  clearable = true,
}: {
  value?: Date;
  onValueChange: (date?: Date) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(formatDate(value));
  const [inputError, setInputError] = useState(false);

  useEffect(() => {
    setInputValue(formatDate(value));
    setInputError(false);
  }, [value]);

  function commitInput() {
    if (!inputValue.trim()) {
      onValueChange(undefined);
      setInputError(false);
      return;
    }

    const parsed = parseDate(inputValue);
    if (parsed) {
      onValueChange(parsed);
      setInputValue(formatDate(parsed));
      setInputError(false);
    } else {
      setInputError(true);
    }
  }

  return (
    <DateField
      id={id}
      label={label}
      hint={hint}
      error={error || (inputError ? "Введите дату в формате ДД.ММ.ГГГГ" : undefined)}
      required={required}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <div className="app-date-trigger-wrap">
          <input
            id={id}
            className="app-date-input"
            value={inputValue}
            placeholder={placeholder}
            inputMode="numeric"
            disabled={disabled}
            aria-invalid={Boolean(error || inputError)}
            onChange={(event) => {
              setInputValue(applyDateMask(event.target.value));
              setInputError(false);
            }}
            onBlur={commitInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitInput();
              }
            }}
          />
          <PopoverTrigger asChild>
            <button
              type="button"
              className="app-date-icon-button"
              disabled={disabled}
              aria-label="Открыть календарь"
            >
              <CalendarDays size={18} />
            </button>
          </PopoverTrigger>
          {clearable && value && !disabled && (
            <button
              type="button"
              className="app-date-clear"
              aria-label="Очистить дату"
              onClick={() => {
                setInputValue("");
                setInputError(false);
                onValueChange(undefined);
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <CalendarPopover>
          <Calendar
            mode="single"
            selected={value}
            onSelect={(date) => {
              onValueChange(date);
              setInputValue(formatDate(date));
              setInputError(false);
              if (date) setOpen(false);
            }}
          />
        </CalendarPopover>
      </Popover>
    </DateField>
  );
}

export function AppDateTimePicker({
  value,
  onValueChange,
  onValidityChange,
  label,
  hint,
  error,
  required,
  placeholder = "ДД.ММ.ГГГГ ЧЧ:ММ",
  disabled,
  clearable = true,
}: {
  value?: Date;
  onValueChange: (date?: Date) => void;
  onValidityChange?: (valid: boolean) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(formatDateTime(value));
  const [inputError, setInputError] = useState(false);

  useEffect(() => {
    setInputValue(formatDateTime(value));
    setInputError(false);
  }, [value]);

  const validationMessage =
    error ||
    (!inputValue.trim()
      ? required
        ? "Укажите дату и время"
        : ""
      : !parseDateTime(inputValue)
        ? "Введите корректную дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ"
        : "");

  useEffect(() => {
    inputRef.current?.setCustomValidity(validationMessage);
    onValidityChange?.(!validationMessage);
  }, [validationMessage, onValidityChange]);

  function commitInput() {
    if (!inputValue.trim()) {
      // Required fields retain the empty text until corrected. Do not let a
      // consumer replace undefined with a default date and hide the error.
      if (!required) onValueChange(undefined);
      setInputError(Boolean(required));
      inputRef.current?.setCustomValidity(required ? "Укажите дату и время" : (error ?? ""));
      onValidityChange?.(!required && !error);
      return;
    }

    const parsed = parseDateTime(inputValue);
    if (parsed) {
      onValueChange(parsed);
      setInputValue(formatDateTime(parsed));
      setInputError(false);
    } else {
      setInputError(true);
    }
  }

  function setTime(time: string) {
    const [hour, minute] = time.split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return;
    const next = value ? new Date(value) : new Date();
    next.setHours(hour, minute, 0, 0);
    onValueChange(next);
    setInputValue(formatDateTime(next));
    setInputError(false);
  }

  return (
    <DateField
      id={id}
      label={label}
      hint={hint}
      error={error || (inputError ? validationMessage : undefined)}
      required={required}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <div className="app-date-trigger-wrap">
          <input
            ref={inputRef}
            id={id}
            required={required}
            className="app-date-input"
            value={inputValue}
            placeholder={placeholder}
            inputMode="numeric"
            disabled={disabled}
            aria-invalid={Boolean(error || inputError)}
            onChange={(event) => {
              const next = applyDateTimeMask(event.target.value);
              const parsed = parseDateTime(next);
              const valid = parsed !== undefined || (!required && !next.trim());
              event.currentTarget.setCustomValidity(
                valid
                  ? (error ?? "")
                  : "Введите корректную дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ",
              );
              setInputValue(next);
              setInputError(false);
              onValidityChange?.(valid && !error);
              if (parsed) onValueChange(parsed);
              else if (!required && !next.trim()) onValueChange(undefined);
            }}
            onInvalid={() => setInputError(true)}
            onBlur={commitInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitInput();
              }
            }}
          />
          <PopoverTrigger asChild>
            <button
              type="button"
              className="app-date-icon-button"
              disabled={disabled}
              aria-label="Открыть выбор даты и времени"
            >
              <CalendarDays size={18} />
            </button>
          </PopoverTrigger>
          {clearable && value && !disabled && (
            <button
              type="button"
              className="app-date-clear"
              aria-label="Очистить дату и время"
              onClick={() => {
                setInputValue("");
                setInputError(Boolean(required));
                inputRef.current?.setCustomValidity(
                  required ? "Укажите дату и время" : (error ?? ""),
                );
                onValidityChange?.(!required && !error);
                if (!required) onValueChange(undefined);
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <CalendarPopover>
          <Calendar
            mode="single"
            selected={value}
            onSelect={(date) => {
              if (!date) return;
              const source = value ?? new Date();
              const next = new Date(date);
              next.setHours(source.getHours(), source.getMinutes(), 0, 0);
              onValueChange(next);
              setInputValue(formatDateTime(next));
              setInputError(false);
            }}
          />
          <label className="app-date-time-picker__time" htmlFor={`${id}-time`}>
            <span>Время</span>
            <input
              id={`${id}-time`}
              type="time"
              value={value ? format(value, "HH:mm") : ""}
              disabled={disabled}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </CalendarPopover>
      </Popover>
    </DateField>
  );
}

export function AppDateRangePicker({
  value,
  onValueChange,
  label,
  hint,
  error,
  required,
  disabled,
}: {
  value?: DateRange;
  onValueChange: (range?: DateRange) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const formattedRange = value?.from
    ? value.to
      ? `${formatDate(value.from)} — ${formatDate(value.to)}`
      : formatDate(value.from)
    : "";
  const [inputValue, setInputValue] = useState(formattedRange);
  const [inputError, setInputError] = useState(false);

  useEffect(() => {
    setInputValue(formattedRange);
    setInputError(false);
  }, [formattedRange]);

  function commitRange() {
    if (!inputValue.trim()) {
      onValueChange(undefined);
      setInputError(false);
      return;
    }

    const matches = extractDates(inputValue);
    const from = matches[0] ? parseDate(matches[0]) : undefined;
    const to = matches[1] ? parseDate(matches[1]) : undefined;

    if (from && (!matches[1] || to)) {
      const nextRange = { from, to };
      onValueChange(nextRange);
      setInputValue(to ? `${formatDate(from)} — ${formatDate(to)}` : formatDate(from));
      setInputError(false);
    } else {
      setInputError(true);
    }
  }

  return (
    <DateField
      id={id}
      label={label}
      hint={hint}
      error={error || (inputError ? "Введите период: ДД.ММ.ГГГГ — ДД.ММ.ГГГГ" : undefined)}
      required={required}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <div className="app-date-trigger-wrap">
          <input
            id={id}
            className="app-date-input"
            value={inputValue}
            placeholder="Выберите период"
            inputMode="numeric"
            disabled={disabled}
            aria-invalid={Boolean(error || inputError)}
            onChange={(event) => {
              setInputValue(applyDateRangeMask(event.target.value));
              setInputError(false);
            }}
            onBlur={commitRange}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRange();
              }
            }}
          />
          <PopoverTrigger asChild>
            <button
              type="button"
              className="app-date-icon-button"
              disabled={disabled}
              aria-label="Открыть календарь"
            >
              <CalendarDays size={18} />
            </button>
          </PopoverTrigger>
          {value?.from && !disabled && (
            <button
              type="button"
              className="app-date-clear"
              aria-label="Очистить период"
              onClick={() => {
                setInputValue("");
                setInputError(false);
                onValueChange(undefined);
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <CalendarPopover>
          <Calendar
            mode="range"
            selected={value}
            onSelect={(range) => {
              onValueChange(range);
              setInputValue(
                range?.from
                  ? range.to
                    ? `${formatDate(range.from)} — ${formatDate(range.to)}`
                    : formatDate(range.from)
                  : "",
              );
              setInputError(false);
            }}
          />
        </CalendarPopover>
      </Popover>
    </DateField>
  );
}
