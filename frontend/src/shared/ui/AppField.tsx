import {
  forwardRef,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import "./AppField.css";

type FieldMetaProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  fieldClassName?: string;
};

function Field({
  id,
  label,
  hint,
  error,
  required,
  fieldClassName = "",
  children,
}: FieldMetaProps & { id: string; children: ReactNode }) {
  return (
    <div className={`field ${error ? "field--error" : ""} ${fieldClassName}`}>
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
          {required && <b aria-hidden="true">*</b>}
        </label>
      )}
      {children}
      {(error || hint) && (
        <small className="field__message" role={error ? "alert" : undefined}>
          {error || hint}
        </small>
      )}
    </div>
  );
}

export type AppInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> &
  FieldMetaProps & {
    prefix?: ReactNode;
    suffix?: ReactNode;
  };

export const AppInput = forwardRef<HTMLInputElement, AppInputProps>(function AppInput(
  {
    label,
    hint,
    error,
    required,
    fieldClassName,
    prefix,
    suffix,
    id: suppliedId,
    className = "",
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;

  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      fieldClassName={fieldClassName}
    >
      <div className={`app-input-shell ${props.disabled ? "is-disabled" : ""}`}>
        {prefix && <span className="app-input-affix">{prefix}</span>}
        <input
          ref={ref}
          id={id}
          className={`app-input ${className}`}
          aria-invalid={Boolean(error)}
          required={required}
          {...props}
        />
        {suffix && <span className="app-input-affix">{suffix}</span>}
      </div>
    </Field>
  );
});

export const AppTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & FieldMetaProps
>(function AppTextarea(
  {
    label,
    hint,
    error,
    required,
    fieldClassName,
    id: suppliedId,
    className = "",
    onDoubleClick,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;

  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      fieldClassName={fieldClassName}
    >
      <textarea
        ref={ref}
        id={id}
        className={`app-input ${className}`}
        aria-invalid={Boolean(error)}
        required={required}
        onDoubleClick={(event) => {
          onDoubleClick?.(event);
          if (event.defaultPrevented) return;

          const textarea = event.currentTarget;
          const bounds = textarea.getBoundingClientRect();
          const resizeHandleSize = 26;
          const clickedResizeHandle =
            event.clientX >= bounds.right - resizeHandleSize &&
            event.clientY >= bounds.bottom - resizeHandleSize;

          if (clickedResizeHandle && textarea.scrollHeight > textarea.clientHeight) {
            textarea.style.height = `${textarea.scrollHeight}px`;
          }
        }}
        {...props}
      />
    </Field>
  );
});

export function AppNumberInput(props: Omit<AppInputProps, "type">) {
  return <AppInput type="number" inputMode="decimal" {...props} />;
}

export function AppMoneyInput({
  value,
  onValueChange,
  currency = "₸",
  maximumFractionDigits = 2,
  suffixAction,
  ...props
}: Omit<AppInputProps, "value" | "onChange" | "type" | "suffix"> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  currency?: string;
  maximumFractionDigits?: number;
  suffixAction?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const displayValue =
    value === null
      ? ""
      : focused
        ? String(value)
        : new Intl.NumberFormat("ru-KZ", { maximumFractionDigits }).format(value);

  return (
    <AppInput
      {...props}
      value={displayValue}
      inputMode="decimal"
      suffix={
        suffixAction ? (
          <span className="app-money-input-suffix">
            <span>{currency}</span>
            {suffixAction}
          </span>
        ) : (
          currency
        )
      }
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      onChange={(event) => {
        const normalized = event.target.value.replace(/\s/g, "").replace(",", ".");
        if (!normalized) onValueChange(null);
        else if (!Number.isNaN(Number(normalized))) onValueChange(Number(normalized));
      }}
    />
  );
}

function formatPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith("7")) digits = `7${digits}`;
  digits = digits.slice(0, 11);
  const body = digits.slice(1);
  let result = "+7";
  if (body.length) result += ` (${body.slice(0, 3)}`;
  if (body.length >= 3) result += ")";
  if (body.length > 3) result += ` ${body.slice(3, 6)}`;
  if (body.length > 6) result += `-${body.slice(6, 8)}`;
  if (body.length > 8) result += `-${body.slice(8, 10)}`;
  return result;
}

export function AppPhoneInput({
  value,
  onValueChange,
  ...props
}: Omit<AppInputProps, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <AppInput
      {...props}
      type="tel"
      inputMode="tel"
      value={formatPhone(value)}
      placeholder="+7 (___) ___-__-__"
      onChange={(event) => onValueChange(formatPhone(event.target.value))}
    />
  );
}

export const AppSearchInput = forwardRef<HTMLInputElement, Omit<AppInputProps, "type" | "prefix">>(
  function AppSearchInput(props, ref) {
    return <AppInput ref={ref} type="search" prefix={<Search size={18} />} {...props} />;
  },
);

export type AppSelectOption = {
  /** Additional searchable names without changing the visible label. */
  keywords?: string[];
  value: string;
  label: string;
  disabled?: boolean;
};

function getSelectedItemsLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "элемент"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "элемента"
        : "элементов";
  return `${count} ${word}`;
}

type EnhancedSelectProps = FieldMetaProps & {
  options: AppSelectOption[];
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  multiple?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  showSelectedTags?: boolean;
  multipleValueDisplay?: "labels" | "count";
  /** Custom text for a multi-select trigger based on the current selection. */
  multipleValueLabel?: (selectedOptions: AppSelectOption[], options: AppSelectOption[]) => string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  FieldMetaProps & { options?: never };

export function AppSelect(props: EnhancedSelectProps | NativeSelectProps) {
  const generatedId = useId();

  if (!("options" in props) || !props.options) {
    const {
      label,
      hint,
      error,
      required,
      fieldClassName,
      id: suppliedId,
      children,
      className = "",
      ...nativeProps
    } = props as NativeSelectProps;
    const id = suppliedId ?? generatedId;
    return (
      <Field
        id={id}
        label={label}
        hint={hint}
        error={error}
        required={required}
        fieldClassName={fieldClassName}
      >
        <select
          id={id}
          className={`app-input ${className}`}
          aria-invalid={Boolean(error)}
          required={required}
          {...nativeProps}
        >
          {children}
        </select>
      </Field>
    );
  }

  return <EnhancedSelect {...props} id={generatedId} />;
}

function EnhancedSelect({
  id,
  options,
  value,
  onValueChange,
  multiple = false,
  searchable = false,
  clearable = true,
  showSelectedTags = true,
  multipleValueDisplay = "labels",
  multipleValueLabel,
  placeholder = "Выберите значение",
  disabled,
  ariaLabel,
  ...meta
}: EnhancedSelectProps & { id: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = useMemo(
    () =>
      multiple ? (Array.isArray(value) ? value : []) : typeof value === "string" ? [value] : [],
    [multiple, value],
  );
  const selectedOptions = options.filter((option) => selected.includes(option.value));

  function toggle(nextValue: string) {
    if (multiple) {
      const next = selected.includes(nextValue)
        ? selected.filter((item) => item !== nextValue)
        : [...selected, nextValue];
      onValueChange?.(next);
      return;
    }
    onValueChange?.(nextValue);
    setOpen(false);
  }

  return (
    <Field id={id} {...meta}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            id={id}
            type="button"
            className="app-select-trigger"
            disabled={disabled}
            aria-expanded={open}
            aria-label={ariaLabel ?? meta.label}
          >
            <span className={selectedOptions.length ? "" : "is-placeholder"}>
              {selectedOptions.length
                ? multiple
                  ? multipleValueLabel
                    ? multipleValueLabel(selectedOptions, options)
                    : multipleValueDisplay === "count"
                      ? selectedOptions.length === 1
                        ? selectedOptions[0].label
                        : getSelectedItemsLabel(selectedOptions.length)
                      : selectedOptions.map((option) => option.label).join(", ")
                  : selectedOptions[0].label
                : placeholder}
            </span>
            {multiple && clearable && selectedOptions.length > 0 && (
              <span
                className="app-select-clear"
                role="button"
                tabIndex={0}
                aria-label="Очистить выбранные значения"
                onClick={(event) => {
                  event.stopPropagation();
                  onValueChange?.([]);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onValueChange?.([]);
                  }
                }}
              >
                <X size={14} />
              </span>
            )}
            <ChevronDown size={18} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="app-select-popover">
          <Command>
            {searchable && <CommandInput placeholder="Поиск..." />}
            <CommandList>
              <CommandEmpty className="app-select-empty">Ничего не найдено</CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  keywords={option.keywords}
                  disabled={option.disabled}
                  onSelect={() => toggle(option.value)}
                >
                  <span
                    className={`app-select-check ${selected.includes(option.value) ? "active" : ""}`}
                  >
                    {selected.includes(option.value) && <Check size={14} />}
                  </span>
                  {option.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {multiple && showSelectedTags && selectedOptions.length > 0 && (
        <div className="app-select-tags">
          {selectedOptions.map((option) => (
            <button type="button" key={option.value} onClick={() => toggle(option.value)}>
              {option.label}
              <X size={13} />
            </button>
          ))}
          {clearable && selectedOptions.length > 1 && (
            <button type="button" className="clear-all" onClick={() => onValueChange?.([])}>
              Очистить
            </button>
          )}
        </div>
      )}
    </Field>
  );
}
