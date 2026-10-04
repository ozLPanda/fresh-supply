import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createWarehousePriceSettingGroup,
  type WarehousePriceSettingGroup,
  type WarehousePriceSettingGroupInput,
} from "@/shared/api/warehouse";
import { AppButton } from "@/shared/ui/AppButton";
import { AppInput, AppTextarea } from "@/shared/ui/AppField";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppRichTextEditor } from "@/shared/ui/AppRichTextEditor";
import { appToast } from "@/shared/ui/AppToast";
import "./WarehousePriceGroupModal.css";

const emptyInput = (): WarehousePriceSettingGroupInput => ({
  name: "",
  commonRules: "",
  comment: "",
});

export function WarehousePriceGroupCreateModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (group: WarehousePriceSettingGroup) => void;
}) {
  const [input, setInput] = useState<WarehousePriceSettingGroupInput>(emptyInput);
  const queryClient = useQueryClient();
  const createGroup = useMutation({
    mutationFn: () => createWarehousePriceSettingGroup({ ...input, name: input.name.trim() }),
    onSuccess: (group) => {
      queryClient.setQueryData<WarehousePriceSettingGroup[]>(
        ["warehouse-price-setting-groups"],
        (current = []) => [group, ...current.filter((item) => item.id !== group.id)],
      );
      setInput(emptyInput());
      onCreated(group);
      onOpenChange(false);
      appToast.success("Группа создана");
    },
  });

  function changeOpen(next: boolean) {
    if (!next && createGroup.isPending) return;
    if (!next) {
      setInput(emptyInput());
      createGroup.reset();
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.name.trim() || createGroup.isPending) return;
    createGroup.mutate();
  }

  return (
    <AppModal
      open={open}
      onOpenChange={changeOpen}
      title="Создать группу установки цен"
      description="После создания группа будет сразу выбрана."
      contentClassName="warehouse-price-group-modal"
    >
      <form className="warehouse-price-group-modal__form" onSubmit={submit}>
        <AppInput
          label="Название группы"
          required
          autoFocus
          value={input.name}
          placeholder="Сентябрь — цены от приходной"
          onChange={(event) => setInput((current) => ({ ...current, name: event.target.value }))}
        />
        <AppRichTextEditor
          label="Правила установки цен для группы"
          hint="Агент применит их при анализе документа и создании цен. Правила можно изменить позднее."
          value={input.commonRules ?? ""}
          placeholder="Опишите правила, исключения и формулы для всех типов цен этой группы."
          onValueChange={(commonRules) => setInput((current) => ({ ...current, commonRules }))}
        />
        <AppTextarea
          label="Комментарий"
          rows={2}
          value={input.comment ?? ""}
          placeholder="Служебная заметка для команды"
          onChange={(event) => setInput((current) => ({ ...current, comment: event.target.value }))}
        />
        {createGroup.error && (
          <AppAlert title="Не удалось создать группу" tone="danger">
            {createGroup.error instanceof Error
              ? createGroup.error.message
              : "Повторите попытку позже"}
          </AppAlert>
        )}
        <div className="warehouse-price-group-modal__actions">
          <AppButton type="button" variant="ghost" onClick={() => changeOpen(false)}>
            Отмена
          </AppButton>
          <AppButton
            type="submit"
            loading={createGroup.isPending}
            loadingText="Создаём"
            disabled={!input.name.trim()}
          >
            Создать и выбрать
          </AppButton>
        </div>
      </form>
    </AppModal>
  );
}
