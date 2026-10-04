---
name: company-shop-permissions
description: Add, update, or audit permissions and roles in the company_shop Spring/React app. Use when Codex needs to create new permission codes, seed roles, wire access checks through AuthContext, expose admin navigation/page access, update role/user DTO behavior, or verify RBAC migrations and tests.
---

# Company Shop Permissions

Use this skill for any task that changes RBAC: permissions, roles, role-permission links, direct user permissions, admin navigation visibility, or controller/service access checks.

## Project model

- Permissions live in `permissions(code, entity_name, action_name, name_ru)`.
- Roles live in `roles(code, name_ru, name_kk, active)`.
- Role grants live in `role_permissions(role_id, permission_id)`.
- Direct user grants live in `user_permissions(user_id, permission_id)`.
- User role assignment lives in `user_roles(user_id, role_id)`.
- Effective permissions are direct user permissions plus active role permissions.
- Backend access checks should use `AuthContext.require("permission.code")`.
- Frontend admin navigation is filtered in `frontend/src/layouts/AdminLayout.tsx` by `CurrentUser.permissions`.
- `adminAccess` is true when the user has an administrator role or at least one `pages.*` permission.

## Naming rules

- Page visibility permissions: `pages.<area>.view`, for example `pages.orders.view`.
- Entity operations: `<entity>.<action>`, for example `roles.read`, `orders.update`, `balances.manage`.
- Prefer stable English lowercase codes; do not localize permission codes.
- Use `entity_name` close to the module name (`orders`, `balances`, `pages.orders`).
- Use `action_name` as a short verb (`read`, `create`, `update`, `delete`, `manage`, `view`).
- Use readable Russian `name_ru` for admin UI display.

## Русские названия и группировка в админке

- При каждом создании или изменении права заполняй `name_ru` понятным русским названием действия и объекта: например, «Просмотр заказов», «Изменение заказов». Для новых ролей также задавай осмысленное русское `name_ru`. Технические `code`, `entity_name` и `action_name` сохраняй на английском; не подменяй ими пользовательские названия.
- Перед добавлением прав изучи существующие группы и распределяй новые права по бизнес-смыслу через `entity_name`. Используй подходящую существующую группу; создавай новую только для самостоятельной области. Не создавай дубли групп из-за другого написания и не складывай несвязанные права в общую группу.
- Проверь `frontend/src/shared/lib/permissionLabels.ts`: для новых групп и действий добавляй русские подписи в существующие словари. Не рассчитывай на fallback, который может показать технический английский идентификатор в админке.
- Учитывай фактическую группировку в `RolesPage.tsx` и отображение и фильтры в `PermissionsPage.tsx`. Права `pages.<area>.view` размещай согласно существующей структуре групп страниц, а операции — в группе соответствующей сущности.
- Если требуется исправить название или группу существующего права, используй новую Flyway-миграцию с целевым обновлением. `on conflict do nothing` не исправляет уже сохранённые значения. Сохраняй коды и назначения прав, если задача не требует их изменения.
- При проверке результата убедись, что каждое добавленное право видно с русским названием, находится в ожидаемой группе с русским заголовком и корректно отображается в списке прав, фильтрах и форме назначения прав роли. Проверяй это при каждом добавлении прав, а не только при изменении самой админки.

## Workflow

1. Inspect current permission usage.
   - Search backend: `rg "auth.require|\\.require\\(\"" backend/src/main/java`.
   - Search migrations: `rg "insert into permissions|role_permissions|roles" backend/src/main/resources/db/migration`.
   - Search frontend nav: `frontend/src/layouts/AdminLayout.tsx`.
   - Inspect permission labels and grouping: `frontend/src/shared/lib/permissionLabels.ts`, `RolesPage.tsx`, and `PermissionsPage.tsx` under `frontend/src/pages/admin/`.

2. Add a Flyway migration for new permissions/roles.
   - Create the next `V###__*.sql`.
   - Insert permissions with idempotent conflict handling.
   - Grant admin role new permissions unless the task explicitly says not to.
   - When adding a new built-in role, seed it with only the required permissions.

   Use this pattern:

   ```sql
   insert into permissions(code, entity_name, action_name, name_ru) values
   ('orders.update', 'orders', 'update', 'Изменение заказов')
   on conflict (code) do nothing;

   insert into role_permissions(role_id, permission_id)
   select r.id, p.id
   from roles r
   join permissions p on p.code in ('orders.update')
   where r.code = 'administrator'
   on conflict do nothing;
   ```

3. Wire backend checks.
   - Put access checks in thin controllers before delegating to services.
   - Use existing permission codes; do not duplicate checks in service unless a service method is called from multiple trust boundaries.
   - For list/read admin endpoints, prefer page/read permissions consistently with existing modules.

4. Wire frontend visibility.
   - Add new admin menu items in `AdminLayout.tsx` with the page permission.
   - Add route guards where routes are protected by permission checks in `main.tsx`.
   - Keep `CurrentUser.permissions` as the source of truth in UI.

5. Update DTO/types only if shape changes.
   - Backend role DTO: `roles/dto/RoleDto.java`.
   - Backend user DTO: `users/dto/UserDto.java`.
   - Frontend types: `frontend/src/shared/types/models.ts`.

6. Verify.
   - Backend: targeted tests if access behavior changes; otherwise `mvn test`/package when feasible.
   - Frontend: `npx.cmd tsc -b`; run build if UI/routes changed.
   - Manually check that a user without the permission cannot see or call the admin feature, and an administrator can.
   - Verify Russian permission, role, group, and action labels, and confirm that every new permission belongs to the intended group in the permissions list and role form.

## Common cases

### Add a new admin page

- Add `pages.<page>.view`.
- Grant it to `administrator`.
- Add route guard with the same permission.
- Add nav entry with the same permission.
- Add backend controller check if the page calls an admin API.

### Add a new operation permission

- Add `<entity>.<action>`.
- Check the matching controller endpoint with `auth.require(...)`.
- Grant administrator by default.
- If the permission is used for notifications or background targeting, update repository queries such as `findActiveWithPermission`.

### Add a new role

- Insert into `roles`.
- Insert role permissions through `role_permissions`.
- Do not assign the role to users unless the task explicitly requires it.
- Keep built-in role codes stable; never rename codes in-place unless a migration updates all references.

## Pitfalls

- Do not rely only on hiding UI; backend endpoints must enforce permissions.
- Do not use `pages.*` permissions for non-page operations.
- Do not forget `on conflict do nothing` in seed migrations.
- Do not grant broad permissions to non-admin roles unless explicitly requested.
- Do not break existing admin access: new admin features should usually be granted to `administrator`.
- Do not add permissions directly in code without a migration; UI lists permissions from the database.
