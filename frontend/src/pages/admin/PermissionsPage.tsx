import { useQuery } from "@tanstack/react-query";
import { FileKey2, KeyRound, Layers3, Settings2 } from "lucide-react";
import { api } from "@/shared/api/http";
import { Permission } from "@/shared/types/models";
import { permissionActionLabel, permissionEntityLabel } from "@/shared/lib/permissionLabels";
import { AdminPage } from "@/layouts/AdminPage";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";

export function PermissionsPage() {
  const permissions = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api<Permission[]>("/api/permissions"),
  });
  const data = permissions.data ?? [];

  const columns: AppDataTableColumn<Permission>[] = [
    {
      id: "code",
      header: "Код",
      accessor: "code",
      sortable: true,
      cell: (permission) => <code>{permission.code}</code>,
    },
    {
      id: "entityName",
      header: "Раздел",
      accessor: "entityName",
      sortable: true,
      filterable: true,
      filterOptions: Array.from(new Set(data.map((permission) => permission.entityName))).map(
        (entityName) => ({ value: entityName, label: permissionEntityLabel(entityName) }),
      ),
      cell: (permission) => permissionEntityLabel(permission.entityName),
    },
    {
      id: "actionName",
      header: "Действие",
      accessor: "actionName",
      sortable: true,
      cell: (permission) => permissionActionLabel(permission.actionName),
    },
    {
      id: "nameRu",
      header: "Название",
      accessor: "nameRu",
      sortable: true,
    },
  ];

  return (
    <AdminPage title="Права" eyebrow="Пользователи и доступы">
      <div className="metric-grid">
        <MetricCard
          icon={<KeyRound size={18} />}
          label="Всего прав"
          value={data.length}
          size="compact"
        />
        <MetricCard
          icon={<FileKey2 size={18} />}
          label="Страницы"
          value={data.filter((permission) => permission.code.startsWith("pages.")).length}
          accent
          size="compact"
        />
        <MetricCard
          icon={<Settings2 size={18} />}
          label="CRUD"
          value={data.filter((permission) => !permission.code.startsWith("pages.")).length}
          size="compact"
        />
        <MetricCard
          icon={<Layers3 size={18} />}
          label="Модули"
          value={new Set(data.map((permission) => permission.entityName)).size}
          size="compact"
        />
      </div>

      <DataPanel title="Справочник прав">
        <AppDataTable
          data={data}
          columns={columns}
          rowId={(permission) => String(permission.id)}
          loading={permissions.isLoading}
          error={permissions.isError ? "Не удалось загрузить права" : undefined}
          selectable={false}
          emptyTitle="Права не найдены"
          emptyDescription="Проверьте доступность API или миграции прав."
        />
      </DataPanel>
    </AdminPage>
  );
}
