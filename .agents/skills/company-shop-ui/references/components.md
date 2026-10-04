# Company Shop component reference

## Source of truth

- Components: `frontend/src/shared/ui/`
- Low-level Radix/shadcn wrappers: `frontend/src/components/ui/`
- Interactive catalogue: `frontend/src/pages/admin/UiKitPage.tsx`
- Page catalogue styles: `frontend/src/pages/admin/UiKitPage.css`
- Theme tokens and application layout: `frontend/src/styles.css`

Import through the `@/shared/ui/...` alias. Every shared component must import its adjacent CSS file.

## Component selection

| Need | Component |
| --- | --- |
| Buttons and menus | `AppButton`, `AppSplitButton`, `AppActionMenu` |
| Text, number, money, phone, search, textarea | `AppInput`, `AppNumberInput`, `AppMoneyInput`, `AppPhoneInput`, `AppSearchInput`, `AppTextarea` |
| Native or enhanced select | `AppSelect` |
| Date or period | `AppDatePicker`, `AppDateRangePicker` |
| Checkbox, switch, radio, tabs, upload | `AppCheckbox`, `AppSwitch`, `AppRadioGroup`, `AppTabs`, `AppFileUpload`, `AppImageUpload` |
| Structured surface | `AppCard`, `DataPanel` |
| Status label | `AppBadge` |
| Alerts, modal, tooltip, skeleton | `AppAlert`, `AppModal`, `AppTooltip`, `AppSkeleton` |
| Notifications | `appToast`; mount `AppToaster` once |
| Simple static table | `AppTable` |
| Searchable/filterable data grid | `AppDataTable` |
| Tree data table | `AppTreeDataTable`, `AppTreeDataTableColumn`, `AppTreeTableBulkAction` |
| KPI tile | `MetricCard` |
| Compact mode selector | `SegmentedControl` |
| Responsive analytics chart | `AppChart`, `AppChartTooltip`, `AppChartLegend` |

## Common APIs

### AppButton

- `variant`: `primary | secondary | neutral | ghost | danger`
- `loading`, `loadingText`, `loadingMode`
- Accept native button props and `className`.

### Fields

- Shared metadata: `label`, `hint`, `error`, `required`.
- `AppInput` accepts native input props plus `prefix` and `suffix`.
- `AppMoneyInput` uses `value: number | null` and `onValueChange`.
- `AppPhoneInput` uses `value` and `onValueChange`.
- Enhanced `AppSelect` uses `options`, `value`, `onValueChange`, `multiple`, `searchable`, `clearable`, and `showSelectedTags`.

### AppTabs and SegmentedControl

- `AppTabs` accepts `items`, `variant`, `value`/`defaultValue`, and `onValueChange`.
- `SegmentedControl` accepts strings or `{ value, label, disabled }` items and supports controlled or uncontrolled selection.

### AppDataTable

Define typed `AppDataTableColumn<T>` objects. Use `accessor` or `value`, and optionally `cell`, `searchable`, `sortable`, `filterable`, `filterOptions`, `align`, `width`, `hideable`, or `initialHidden`. Set `searchable: false` for technical or numeric columns that should not affect the built-in client search.

Useful table props include `rowId`, `loading`, `error`, `searchable`, `selectable`, `pageSizes`, `defaultPageSize`, state text, and `bulkActions`.

Pagination modes:

- `mode="client"` keeps search, sorting, filters, and pagination inside the component.
- Pass `pagination={false}` with `mode="client"` to render the complete locally filtered and sorted row set without page controls. Combine it with `virtualized` and `scrollHeight` for a bounded, searchable table that keeps only the visible rows in the DOM.
- `mode="server"` uses controlled search, sorting, filters, and numbered pagination.
- `mode="infinite"` treats `data` as the accumulated server result and replaces pagination with scroll loading. Pass `hasMore`, `loadingMore`, and `onLoadMore`; use `totalItems` when the server reports the total. For next-page failures, pass `loadMoreError` and `onRetryLoadMore` so already loaded rows remain visible.

Set `virtualized` to render only the visible row window plus `overscan`. `scrollHeight`, `rowHeight`, and `loadMoreThreshold` tune its fixed viewport and loading threshold. Keep `rowHeight` large enough for the tallest cell content. Selection is keyed by `rowId` and is preserved when remote search, sorting, or filtering replaces the current data.

### AppTreeDataTable

Use `AppTreeDataTableColumn<T>` together with `rowId`, `getChildren`, and `treeColumnId`. The tree column renders the expander, indent, hierarchy cues, and main content. Tree tables support `defaultExpandedIds`, controlled `expandedIds`, `expandAllByDefault`, `showChildCount`, `selectionBehavior`, `pageSizes`, `defaultPageSize`, `bulkActions`, `loading`, `error`, and the same column visibility and filter controls as `AppDataTable`.

### Surface components

- `AppCard`: `title`, `description`, `actions`, `footer`, `className`, `style`.
- `DataPanel`: `title`, `actions`, `className`, `style`.
- `MetricCard`: `icon`, `label`, `value`, `trend`, `accent`, `size: default | compact`, `className`, `style`.
- `AppBadge`: `tone`, native span props, and `className`.

### AppChart

- `AppChart` provides a responsive Recharts container with `title`, `description`, `height`, `className`, and `style`.
- Use `appChartColors` for the shared analytics palette.
- Use `AppChartTooltip` for the standard tooltip and `AppChartLegend` with `useAppChartLegend` for interactive series visibility.

### AppImageUpload

- Accepts normalized `items` with `id`, `src`, `name`, optional `main`, and optional `pending`.
- Use `maxFiles`, `onFilesSelected`, `onRemove`, and `onSetMain`; keep API calls and product state in the page.
- Supports JPEG, PNG and WEBP selection, drag-and-drop, main-image marking, previews, and disabled/uploading state.

## Customization examples

Use props for semantic variants:

```tsx
<AppButton variant="danger" loading={deleting}>
  Удалить
</AppButton>
```

Use CSS variables for local visual tuning:

```tsx
<MetricCard
  icon={<Package />}
  label="Товары"
  value={count}
  accent
  style={{ "--metric-accent": "#2563eb" } as React.CSSProperties}
/>
```

Use composition for page-specific layout:

```tsx
<DataPanel title="Товары" actions={<AppButton>Добавить</AppButton>}>
  <AppDataTable data={products} columns={columns} rowId={(row) => row.id} />
</DataPanel>
```

Do not copy `.app-button`, `.field`, `.app-data-table`, or other shared selectors into page CSS.
