import { useRef } from "react";
import { Plus, X } from "lucide-react";
import { AppButton } from "@/shared/ui/AppButton";
import { AppInput } from "@/shared/ui/AppField";
import "./RegularBuyerAliasesField.css";

export function appendRegularBuyerAlias(aliases: string[], draft: string): string[] {
  const normalized = draft.replace(/\s+/g, " ").trim();
  if (!normalized) return aliases;
  if (normalized.length > 120)
    throw new Error("Название в заявке не должно превышать 120 символов.");
  const key = (value: string) =>
    value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  if (aliases.some((alias) => key(alias) === key(normalized))) return aliases;
  if (aliases.length >= 50)
    throw new Error(
      "Можно добавить не больше 50 названий. Удалите лишнее название перед добавлением нового.",
    );
  return [...aliases, normalized];
}

export function RegularBuyerAliasesField({
  aliases,
  draft,
  error,
  disabled,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  aliases: string[];
  draft: string;
  error?: string;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  function add() {
    onAdd();
    inputRef.current?.focus();
  }
  return (
    <div className="regular-buyer-aliases">
      <AppInput
        ref={inputRef}
        label="Названия в заявках"
        value={draft}
        disabled={disabled}
        placeholder="Например: Викинг или Ресторан Викинг"
        hint="Введите название и нажмите Enter или +. Эти названия помогут находить покупателя в заявках всех сотрудников."
        error={error}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            add();
          }
        }}
        suffix={
          <AppButton
            type="button"
            variant="ghost"
            className="regular-buyer-aliases__add"
            aria-label="Добавить название в заявках"
            disabled={disabled || !draft.trim()}
            onClick={add}
          >
            <Plus size={18} />
          </AppButton>
        }
      />
      {aliases.length > 0 && (
        <ul
          className="regular-buyer-aliases__tags"
          aria-label="Добавленные названия в заявках"
          tabIndex={0}
        >
          {aliases.map((alias, index) => (
            <li key={`${index}:${alias}`}>
              <span>{alias}</span>
              <AppButton
                type="button"
                variant="ghost"
                className="regular-buyer-aliases__remove"
                disabled={disabled}
                aria-label={`Удалить название «${alias}»`}
                onClick={() => {
                  onRemove(index);
                  inputRef.current?.focus();
                }}
              >
                <X size={14} />
              </AppButton>
            </li>
          ))}
        </ul>
      )}
      <span className="regular-buyer-aliases__count" aria-live="polite">
        Добавлено {aliases.length} из 50
      </span>
    </div>
  );
}
