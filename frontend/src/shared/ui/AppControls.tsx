import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { UploadCloud } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./AppControls.css";

export function AppCheckbox({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="app-choice">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <label htmlFor={id}>
        <b>{label}</b>
        {description && <span>{description}</span>}
      </label>
    </div>
  );
}

export function AppSwitch({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="app-switch-row">
      <label htmlFor={id}>
        <b>{label}</b>
        {description && <span>{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

export function AppRadioGroup({
  label,
  value,
  options,
  onValueChange,
}: {
  label?: string;
  value: string;
  options: { value: string; label: string; description?: string }[];
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="app-control-field">
      {label && <span className="app-control-field__label">{label}</span>}
      <RadioGroup value={value} onValueChange={onValueChange}>
        {options.map((option) => {
          const id = `radio-${option.value}`;
          return (
            <div className="app-choice" key={option.value}>
              <RadioGroupItem id={id} value={option.value} />
              <label htmlFor={id}>
                <b>{option.label}</b>
                {option.description && <span>{option.description}</span>}
              </label>
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
}

export function AppFileUpload({
  label = "Загрузить файл",
  accept,
  multiple,
  disabled,
  onChange,
}: {
  label?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onChange?: (files: File[]) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function matchesAcceptedType(file: File) {
    if (!accept) return true;

    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();
    return accept.split(",").some((rawRule) => {
      const rule = rawRule.trim().toLowerCase();
      if (!rule || rule === "*/*") return true;
      if (rule.startsWith(".")) return fileName.endsWith(rule);
      if (rule.endsWith("/*")) return fileType.startsWith(rule.slice(0, -1));
      return fileType === rule;
    });
  }

  function filesFromTransfer(transfer: DataTransfer) {
    const directFiles = Array.from(transfer.files);
    if (directFiles.length > 0) return directFiles;

    return Array.from(transfer.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
  }

  function hasFiles(transfer: DataTransfer) {
    return Array.from(transfer.types).includes("Files") || filesFromTransfer(transfer).length > 0;
  }

  function selectFiles(files: FileList | File[]) {
    if (disabled) return false;

    const acceptedFiles = Array.from(files).filter((file) => matchesAcceptedType(file));
    if (acceptedFiles.length === 0) return false;

    onChange?.(multiple ? acceptedFiles : acceptedFiles.slice(0, 1));
    return true;
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    selectFiles(event.target.files ?? []);
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    if (disabled || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>) {
    if (disabled || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    const relatedTarget = event.relatedTarget;
    if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    setIsDragging(false);
    const files = filesFromTransfer(event.dataTransfer);
    if (disabled || files.length === 0) return;
    event.preventDefault();
    selectFiles(files);
  }

  function handlePaste(event: ClipboardEvent<HTMLLabelElement>) {
    const files = filesFromTransfer(event.clipboardData);
    if (disabled || files.length === 0) return;
    event.preventDefault();
    selectFiles(files);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLabelElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    inputRef.current?.click();
  }

  return (
    <label
      className={`app-file-upload${isDragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      htmlFor={id}
      tabIndex={disabled ? -1 : 0}
      aria-describedby={`${id}-hint`}
      aria-disabled={disabled}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
    >
      <UploadCloud size={26} />
      <b>{label}</b>
      <span id={`${id}-hint`}>
        Перетащите файл, вставьте через Ctrl/Cmd+V или нажмите для выбора
      </span>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={handleChange}
      />
    </label>
  );
}

export type AppTabsVariant = "underline" | "segmented" | "card";

export type AppTabItem = {
  value: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
  /** Moves this tab to the end of a card/section tab row when space allows. */
  align?: "start" | "end";
  content: ReactNode;
};

export function AppTabs({
  value,
  defaultValue,
  items,
  variant = "underline",
  onValueChange,
}: {
  value?: string;
  defaultValue?: string;
  items: AppTabItem[];
  variant?: AppTabsVariant;
  onValueChange?: (value: string) => void;
}) {
  const fallbackValue = defaultValue ?? items.find((item) => !item.disabled)?.value ?? "";
  const [internalValue, setInternalValue] = useState(fallbackValue);
  const activeValue = value ?? internalValue;
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  function measureIndicator() {
    const list = listRef.current;
    const trigger = triggerRefs.current.get(activeValue);
    if (!list || !trigger) return;
    const listRect = list.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    setIndicator({
      left: triggerRect.left - listRect.left + list.scrollLeft,
      width: triggerRect.width,
    });
  }

  useLayoutEffect(measureIndicator, [activeValue, items, variant]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(measureIndicator);
    observer.observe(list);
    window.addEventListener("resize", measureIndicator);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureIndicator);
    };
  }, [activeValue]);

  function changeValue(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }

  return (
    <Tabs value={activeValue} onValueChange={changeValue} className={`app-tabs variant-${variant}`}>
      <TabsList ref={listRef} className="app-tabs__list">
        <span
          className="app-tabs__indicator"
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
        />
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className={`app-tabs__trigger${item.align === "end" ? " is-aligned-end" : ""}`}
            ref={(node) => {
              if (node) triggerRefs.current.set(item.value, node);
              else triggerRefs.current.delete(item.value);
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count !== undefined && <b className="app-tabs__count">{item.count}</b>}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent key={item.value} value={item.value} className="app-tabs__content">
          {item.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
