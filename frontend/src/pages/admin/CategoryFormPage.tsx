import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api, API_URL } from "@/shared/api/http";
import { fetchAllCategories } from "@/shared/api/catalog";
import { AdminPage } from "@/layouts/AdminPage";
import { Category } from "@/shared/types/models";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppInput, AppNumberInput, AppSelect, AppTextarea } from "@/shared/ui/AppField";
import { AppSwitch } from "@/shared/ui/AppControls";
import { AppImageUpload, type AppImageUploadItem } from "@/shared/ui/AppImageUpload";
import { appToast } from "@/shared/ui/AppToast";
import "./CategoryFormPage.css";

const transliteration: Record<string, string> = {
  "\u0430": "a",
  "\u04d9": "a",
  "\u0431": "b",
  "\u0432": "v",
  "\u0433": "g",
  "\u0493": "gh",
  "\u0434": "d",
  "\u0435": "e",
  "\u0451": "yo",
  "\u0436": "zh",
  "\u0437": "z",
  "\u0438": "i",
  "\u0439": "y",
  "\u043a": "k",
  "\u049b": "q",
  "\u043b": "l",
  "\u043c": "m",
  "\u043d": "n",
  "\u04a3": "ng",
  "\u043e": "o",
  "\u04e9": "o",
  "\u043f": "p",
  "\u0440": "r",
  "\u0441": "s",
  "\u0442": "t",
  "\u0443": "u",
  "\u04b1": "u",
  "\u04af": "u",
  "\u0444": "f",
  "\u0445": "h",
  "\u04bb": "h",
  "\u0446": "ts",
  "\u0447": "ch",
  "\u0448": "sh",
  "\u0449": "sch",
  "\u044a": "",
  "\u044b": "y",
  "\u0456": "i",
  "\u044c": "",
  "\u044d": "e",
  "\u044e": "yu",
  "\u044f": "ya",
};

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function slugify(value: string) {
  return value
    .toLowerCase()
    .split("")
    .map((char) => transliteration[char] ?? char)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function initialCategory(): Category {
  return {
    nameRu: "",
    nameKk: "",
    slug: "",
    parentId: null,
    descriptionRu: "",
    descriptionKk: "",
    imageFileName: "",
    imageOriginalFileName: "",
    imageFilePath: "",
    sortOrder: 0,
    active: true,
  };
}

type SaveResult = {
  saved: Category;
  imageUploadFailed: boolean;
};

export function CategoryFormPage({
  embedded = false,
  categoryId,
  onSaved,
}: {
  embedded?: boolean;
  categoryId?: number;
  onSaved?: (category: Category) => void;
}) {
  const { id: routeId } = useParams();
  const id = categoryId ? String(categoryId) : routeId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = Boolean(id);
  const [category, setCategory] = useState<Category>(initialCategory());
  const [slugTouched, setSlugTouched] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => fetchAllCategories(),
  });

  const currentQuery = useQuery({
    queryKey: ["category", id],
    queryFn: () => api<Category>(`/api/categories/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!currentQuery.data) return;
    setCategory({
      ...initialCategory(),
      ...currentQuery.data,
      parentId: currentQuery.data.parentId ?? null,
      descriptionRu: currentQuery.data.descriptionRu ?? "",
      descriptionKk: currentQuery.data.descriptionKk ?? "",
      imageFileName: currentQuery.data.imageFileName ?? "",
      imageOriginalFileName: currentQuery.data.imageOriginalFileName ?? "",
      imageFilePath: currentQuery.data.imageFilePath ?? "",
      children: currentQuery.data.children ?? [],
    });
    setSlugTouched(false);
  }, [currentQuery.data]);

  const pendingImagePreview = useMemo<AppImageUploadItem | null>(
    () =>
      pendingImage
        ? {
            id: `pending-${pendingImage.name}-${pendingImage.lastModified}`,
            src: URL.createObjectURL(pendingImage),
            name: pendingImage.name,
            pending: true,
          }
        : null,
    [pendingImage],
  );

  useEffect(
    () => () => {
      if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview.src);
    },
    [pendingImagePreview],
  );

  const descendantIds = useMemo(() => {
    if (!category.id) return new Set<number>();
    const childrenByParent = new Map<number, Category[]>();
    (categoriesQuery.data ?? []).forEach((item) => {
      if (item.parentId == null || !item.id) return;
      const parent = item.parentId;
      const list = childrenByParent.get(parent) ?? [];
      list.push(item);
      childrenByParent.set(parent, list);
    });

    const result = new Set<number>();
    const walk = (parentId: number) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (!child.id || result.has(child.id)) continue;
        result.add(child.id);
        walk(child.id);
      }
    };
    walk(category.id);
    return result;
  }, [categoriesQuery.data, category.id]);

  const parentOptions = useMemo(
    () => [
      { value: "", label: "Корневая категория" },
      ...(categoriesQuery.data ?? [])
        .filter(
          (item) =>
            item.id &&
            item.id !== category.id &&
            !descendantIds.has(item.id) &&
            (isEdit ? item.id !== Number(id) : true),
        )
        .map((item) => ({ value: String(item.id), label: item.nameRu })),
    ],
    [categoriesQuery.data, category.id, descendantIds, id, isEdit],
  );

  const loading = categoriesQuery.isLoading || (isEdit && currentQuery.isLoading);
  const errorMessage = categoriesQuery.error
    ? categoriesQuery.error instanceof Error
      ? categoriesQuery.error.message
      : "Не удалось загрузить категории"
    : currentQuery.error
      ? currentQuery.error instanceof Error
        ? currentQuery.error.message
        : "Не удалось загрузить категорию"
      : undefined;

  async function uploadPendingImage(categoryId: number) {
    if (!pendingImage) return null;
    const body = new FormData();
    body.append("file", pendingImage);
    return api<Category>(`/api/categories/${categoryId}/image`, {
      method: "POST",
      body,
    });
  }

  const deleteImage = useMutation({
    mutationFn: () => {
      if (!category.id) throw new Error("Category id is missing");
      return api<Category>(`/api/categories/${category.id}/image`, { method: "DELETE" });
    },
    onSuccess: (updated) => {
      setCategory({
        ...updated,
        parentId: updated.parentId ?? null,
        descriptionRu: updated.descriptionRu ?? "",
        descriptionKk: updated.descriptionKk ?? "",
        imageFileName: updated.imageFileName ?? "",
        imageOriginalFileName: updated.imageOriginalFileName ?? "",
        imageFilePath: updated.imageFilePath ?? "",
        children: updated.children ?? [],
      });
      setPendingImage(null);
      if (!embedded) {
        queryClient.invalidateQueries({ queryKey: ["categories"] });
        if (updated.id)
          queryClient.invalidateQueries({ queryKey: ["category", String(updated.id)] });
      }
      appToast.success("Картинка категории удалена");
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : "Не удалось удалить картинку");
    },
  });

  const save = useMutation<SaveResult>({
    mutationFn: async () => {
      const payload: Category = {
        ...category,
        parentId: category.parentId ?? null,
        slug: category.slug.trim(),
        descriptionRu: category.descriptionRu?.trim() || "",
        descriptionKk: category.descriptionKk?.trim() || "",
      };
      const saved = await api<Category>(id ? `/api/categories/${id}` : "/api/categories", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });

      if (!saved.id || !pendingImage) return { saved, imageUploadFailed: false };

      try {
        const uploaded = await uploadPendingImage(saved.id);
        return { saved: uploaded ?? saved, imageUploadFailed: false };
      } catch {
        return { saved, imageUploadFailed: true };
      }
    },
    onSuccess: ({ saved, imageUploadFailed }) => {
      if (!embedded) {
        queryClient.invalidateQueries({ queryKey: ["categories"] });
        if (saved.id) queryClient.invalidateQueries({ queryKey: ["category", String(saved.id)] });
      }

      if (imageUploadFailed) {
        setCategory(saved);
        const message = isEdit
          ? "Категория сохранена, но картинку загрузить не удалось"
          : "Категория создана, но картинку загрузить не удалось";
        appToast.error(message);
        if (embedded) return;
        if (!isEdit && saved.id) navigate(`/admin/categories/${saved.id}`);
        return;
      }

      appToast.success(isEdit ? "Категория обновлена" : "Категория создана");
      if (embedded) {
        onSaved?.(saved);
        return;
      }
      navigate("/admin/categories");
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : "Не удалось сохранить категорию");
    },
  });

  if (loading) {
    if (embedded) {
      return (
        <div className="category-editor-embed category-editor-embed--state">
          <AppSkeleton />
        </div>
      );
    }
    return (
      <AdminPage
        eyebrow="Товары и услуги"
        title={isEdit ? "Редактирование категории" : "Создание категории"}
        backAction={
          <AppButton
            type="button"
            variant="ghost"
            aria-label="Вернуться к списку категорий"
            title="Вернуться к списку категорий"
            onClick={() => navigate("/admin/categories")}
          >
            <ArrowLeft size={22} />
          </AppButton>
        }
      >
        <AppSkeleton />
      </AdminPage>
    );
  }

  if (errorMessage) {
    if (embedded) {
      return (
        <div className="category-editor-embed category-editor-embed--state">
          <AppAlert title="Не удалось загрузить категорию">{errorMessage}</AppAlert>
        </div>
      );
    }
    return (
      <AdminPage
        eyebrow="Товары и услуги"
        title={isEdit ? "Редактирование категории" : "Создание категории"}
        backAction={
          <AppButton
            type="button"
            variant="ghost"
            aria-label="Вернуться к списку категорий"
            title="Вернуться к списку категорий"
            onClick={() => navigate("/admin/categories")}
          >
            <ArrowLeft size={22} />
          </AppButton>
        }
      >
        <AppAlert title="Не удалось загрузить категорию">{errorMessage}</AppAlert>
      </AdminPage>
    );
  }

  const imageDisabled = save.isPending || deleteImage.isPending;
  const currentImageSrc = category.imageFilePath ? `${API_URL}${category.imageFilePath}` : null;
  const pendingItems = pendingImagePreview ? [pendingImagePreview] : [];

  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      appToast.error(`${file.name}: разрешены только JPEG, PNG и WEBP`);
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      appToast.error(`${file.name}: размер файла не должен превышать 5 МБ`);
      return;
    }
    setPendingImage(file);
  }

  return (
    <AdminPage
      embedded={embedded}
      eyebrow="Товары и услуги"
      title={isEdit ? "Редактирование категории" : "Создание категории"}
      backAction={
        <AppButton
          type="button"
          variant="ghost"
          aria-label="Вернуться к списку категорий"
          title="Вернуться к списку категорий"
          onClick={() => navigate("/admin/categories")}
        >
          <ArrowLeft size={22} />
        </AppButton>
      }
      actions={
        <AppButton
          type="button"
          loading={save.isPending}
          loadingText="Сохранение..."
          onClick={() => save.mutate()}
        >
          <Save size={18} />
          Сохранить
        </AppButton>
      }
    >
      <div className="category-editor">
        <AppCard
          className="category-editor__form"
          title="Основная информация"
          description="Название, slug, родительская категория, порядок сортировки и описание."
        >
          <div className="category-form">
            <AppInput
              label="Название RU"
              required
              value={category.nameRu}
              disabled={save.isPending}
              onChange={(event) => {
                const next = event.target.value;
                setCategory((current) => ({
                  ...current,
                  nameRu: next,
                  slug: slugTouched ? current.slug : slugify(next),
                }));
              }}
            />
            <AppInput
              label="Название KZ"
              required
              value={category.nameKk}
              disabled={save.isPending}
              onChange={(event) => setCategory({ ...category, nameKk: event.target.value })}
            />
            <AppInput
              label="Slug"
              required
              value={category.slug}
              disabled={save.isPending}
              onChange={(event) => {
                setSlugTouched(true);
                setCategory({ ...category, slug: slugify(event.target.value) });
              }}
            />
            <AppSelect
              label="Родительская категория"
              options={parentOptions}
              value={category.parentId ? String(category.parentId) : ""}
              disabled={save.isPending}
              searchable
              clearable
              onValueChange={(value) =>
                setCategory({
                  ...category,
                  parentId: value ? Number(value) : null,
                })
              }
            />
            <AppNumberInput
              label="Порядок сортировки"
              value={category.sortOrder}
              disabled={save.isPending}
              onChange={(event) =>
                setCategory({
                  ...category,
                  sortOrder: Number(event.target.value || 0),
                })
              }
            />
            <div className="category-form__span-2">
              <AppSwitch
                label="Категория активна"
                description="Скрытая категория не отображается в каталоге."
                checked={category.active}
                disabled={save.isPending}
                onCheckedChange={(checked) => setCategory({ ...category, active: checked })}
              />
            </div>
            <AppTextarea
              className="category-form__description"
              fieldClassName="category-form__span-2"
              label="Описание RU"
              value={category.descriptionRu ?? ""}
              disabled={save.isPending}
              onChange={(event) => setCategory({ ...category, descriptionRu: event.target.value })}
            />
            <AppTextarea
              className="category-form__description"
              fieldClassName="category-form__span-2"
              label="Описание KZ"
              value={category.descriptionKk ?? ""}
              disabled={save.isPending}
              onChange={(event) => setCategory({ ...category, descriptionKk: event.target.value })}
            />
          </div>
        </AppCard>

        <AppCard
          className="category-editor__media"
          title="Картинка категории"
          description="Можно загрузить только одно изображение. Новое изображение заменит текущее после сохранения."
        >
          <div className="category-editor__media-content">
            {currentImageSrc ? (
              <div className="category-form__current-image">
                <img
                  src={currentImageSrc}
                  alt={category.imageOriginalFileName || category.nameRu || "Картинка категории"}
                />
                <div className="category-form__current-image-actions">
                  <AppButton
                    type="button"
                    variant="danger"
                    loading={deleteImage.isPending}
                    loadingText="Удаление..."
                    disabled={imageDisabled}
                    onClick={() => deleteImage.mutate()}
                  >
                    <Trash2 size={16} />
                    Удалить картинку
                  </AppButton>
                </div>
              </div>
            ) : (
              <AppAlert title="Картинка не задана">
                Добавьте одно изображение, чтобы оно отображалось у категории.
              </AppAlert>
            )}

            <AppImageUpload
              items={pendingItems}
              maxFiles={1}
              disabled={imageDisabled}
              onFilesSelected={handleFilesSelected}
              onRemove={(_item) => setPendingImage(null)}
            />
          </div>
        </AppCard>
      </div>
    </AdminPage>
  );
}
