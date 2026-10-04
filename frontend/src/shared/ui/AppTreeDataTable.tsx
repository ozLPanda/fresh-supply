import { CSSProperties, ReactNode, useDeferredValue, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsDown,
  ChevronsUp,
  Columns3,
  Folder,
  ListFilter,
  Rows3,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppTooltip } from "@/shared/ui/AppFeedback";
import { AppSearchInput, AppSelect, type AppSelectOption } from "@/shared/ui/AppField";
import "./AppTreeDataTable.css";

export type AppTreeDataTableCellContext = {
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

export type AppTreeDataTableColumn<TData> = {
  id: string;
  header: string;
  accessor?: keyof TData & string;
  value?: (row: TData) => unknown;
  cell?: (row: TData, context: AppTreeDataTableCellContext) => ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  filterOptions?: AppSelectOption[];
  align?: "left" | "center" | "right";
  hideable?: boolean;
  initialHidden?: boolean;
  width?: number;
};

export type AppTreeTableBulkAction<TData> = {
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onSelect: (rows: TData[]) => void;
};

export type AppTreeDataTableProps<TData> = {
  data: TData[];
  columns: AppTreeDataTableColumn<TData>[];
  rowId: (row: TData) => string;
  getChildren: (row: TData) => TData[] | undefined;
  treeColumnId: string;
  loading?: boolean;
  error?: string;
  searchable?: boolean;
  selectable?: boolean;
  selectionBehavior?: "independent" | "cascade";
  defaultExpandedIds?: string[];
  expandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  expandAllByDefault?: boolean;
  showChildCount?: boolean;
  pageSizes?: number[];
  defaultPageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  bulkActions?: AppTreeTableBulkAction<TData>[];
  className?: string;
  style?: CSSProperties;
};

type SortState = {
  id: string;
  desc: boolean;
}[];

type TreeNodeInfo<TData> = {
  id: string;
  row: TData;
  parentId?: string;
  childIds: string[];
  depth: number;
  order: number;
  hasChildren: boolean;
};

type TreeIndex<TData> = {
  nodes: Map<string, TreeNodeInfo<TData>>;
  rootIds: string[];
  expandableIds: string[];
  orderById: Map<string, number>;
};

type TreeViewNode<TData> = TreeNodeInfo<TData> & {
  expanded: boolean;
  visibleChildren: TreeViewNode<TData>[];
};

type SelectionState = {
  selected: boolean;
  indeterminate: boolean;
  selectedIds: string[];
};

const MAX_TREE_DEPTH = 100;

function pageNumbers(pageIndex: number, pageCount: number) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  const values = new Set([0, pageCount - 1, pageIndex - 1, pageIndex, pageIndex + 1]);
  return [...values].filter((page) => page >= 0 && page < pageCount).sort((a, b) => a - b);
}

function normalizeSearchValue(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function getColumnValue<TData>(row: TData, column: AppTreeDataTableColumn<TData>) {
  if (column.value) return column.value(row);
  if (column.accessor) return row[column.accessor];
  return undefined;
}

function compareValues(left: unknown, right: unknown) {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  return String(left).localeCompare(String(right), "ru", {
    numeric: true,
    sensitivity: "base",
  });
}

function buildTreeIndex<TData>({
  data,
  rowId,
  getChildren,
}: {
  data: TData[];
  rowId: (row: TData) => string;
  getChildren: (row: TData) => TData[] | undefined;
}): TreeIndex<TData> {
  const nodes = new Map<string, TreeNodeInfo<TData>>();
  const rootIds: string[] = [];
  const warned = new Set<string>();
  let order = 0;

  function warnDuplicate(id: string) {
    if (warned.has(id) || import.meta.env.PROD) return;
    warned.add(id);
    console.warn(
      `[AppTreeDataTable] Duplicate or cyclic rowId "${id}" was skipped to prevent recursive rendering.`,
    );
  }

  function visit(row: TData, depth: number, parentId?: string, ancestors = new Set<string>()) {
    if (depth >= MAX_TREE_DEPTH) {
      if (import.meta.env.DEV) {
        console.warn(
          `[AppTreeDataTable] Maximum tree depth of ${MAX_TREE_DEPTH} was reached. Branch truncated.`,
        );
      }
      return;
    }

    const id = rowId(row);
    if (nodes.has(id) || ancestors.has(id)) {
      warnDuplicate(id);
      return;
    }

    const info: TreeNodeInfo<TData> = {
      id,
      row,
      parentId,
      childIds: [],
      depth,
      order,
      hasChildren: false,
    };
    order += 1;

    nodes.set(id, info);

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);

    for (const child of getChildren(row) ?? []) {
      const childId = rowId(child);
      if (nodes.has(childId) || nextAncestors.has(childId)) {
        warnDuplicate(childId);
        continue;
      }

      visit(child, depth + 1, id, nextAncestors);
      if (nodes.has(childId)) info.childIds.push(childId);
    }

    info.hasChildren = info.childIds.length > 0;
  }

  for (const root of data) {
    const id = rowId(root);
    if (nodes.has(id)) {
      warnDuplicate(id);
      continue;
    }

    rootIds.push(id);
    visit(root, 0);
  }

  const expandableIds = [...nodes.values()]
    .filter((node) => node.hasChildren)
    .map((node) => node.id);

  return {
    nodes,
    rootIds,
    expandableIds,
    orderById: new Map([...nodes.values()].map((node) => [node.id, node.order] as const)),
  };
}

function buildValuesMap<TData>(row: TData, columns: AppTreeDataTableColumn<TData>[]) {
  return new Map(columns.map((column) => [column.id, getColumnValue(row, column)] as const));
}

function matchesFilters<TData>(
  rowValues: Map<string, unknown>,
  activeFilters: Record<string, string[]>,
) {
  return Object.entries(activeFilters).every(([columnId, selectedValues]) => {
    if (selectedValues.length === 0) return true;
    return selectedValues.includes(String(rowValues.get(columnId) ?? ""));
  });
}

function matchesSearch<TData>(
  rowValues: Map<string, unknown>,
  columns: AppTreeDataTableColumn<TData>[],
  tokens: string[],
) {
  if (tokens.length === 0) return true;

  const fields = columns
    .filter((column) => column.accessor || column.value)
    .map((column) => normalizeSearchValue(rowValues.get(column.id)))
    .filter(Boolean);

  return tokens.every((token) =>
    fields.some(
      (field) => field.includes(token) || field.split(/\s+/).some((word) => word.startsWith(token)),
    ),
  );
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function flattenVisibleNodes<TData>(nodes: TreeViewNode<TData>[]): TreeViewNode<TData>[] {
  const flat: TreeViewNode<TData>[] = [];
  for (const node of nodes) {
    flat.push(node);
    flat.push(...flattenVisibleNodes(node.visibleChildren));
  }
  return flat;
}

function getSelectionClosure<TData>(
  nodeId: string,
  treeIndex: TreeIndex<TData>,
  explicitSelection: Set<string>,
): SelectionState {
  const node = treeIndex.nodes.get(nodeId);
  if (!node) {
    return { selected: false, indeterminate: false, selectedIds: [] };
  }

  if (!node.hasChildren) {
    const selected = explicitSelection.has(nodeId);
    return { selected, indeterminate: false, selectedIds: selected ? [nodeId] : [] };
  }

  const childStates = node.childIds.map((childId) =>
    getSelectionClosure(childId, treeIndex, explicitSelection),
  );
  const childSelectedIds = childStates.flatMap((state) => state.selectedIds);
  const hasSelectedChildren = childStates.some((state) => state.selected || state.indeterminate);
  const allChildrenSelected =
    node.childIds.length > 0 &&
    childStates.every((state) => state.selected && !state.indeterminate);
  const selfExplicit = explicitSelection.has(nodeId);
  const selected = selfExplicit || allChildrenSelected;
  const indeterminate = !selected && hasSelectedChildren;

  return {
    selected,
    indeterminate,
    selectedIds: selected ? unique([nodeId, ...childSelectedIds]) : unique(childSelectedIds),
  };
}

function sortNodeIds<TData>(
  leftId: string,
  rightId: string,
  columnsById: Map<string, AppTreeDataTableColumn<TData>>,
  treeIndex: TreeIndex<TData>,
  sorting: SortState,
) {
  for (const sort of sorting) {
    const column = columnsById.get(sort.id);
    if (!column) continue;
    const leftNode = treeIndex.nodes.get(leftId);
    const rightNode = treeIndex.nodes.get(rightId);
    if (!leftNode || !rightNode) continue;
    const result = compareValues(
      getColumnValue(leftNode.row, column),
      getColumnValue(rightNode.row, column),
    );
    if (result !== 0) return sort.desc ? -result : result;
  }

  return (treeIndex.orderById.get(leftId) ?? 0) - (treeIndex.orderById.get(rightId) ?? 0);
}

function buildVisibleTree<TData>({
  rootIds,
  treeIndex,
  columnsById,
  searchableColumns,
  sorting,
  searchTokens,
  activeFilters,
  hasActiveQuery,
  expandedIds,
}: {
  rootIds: string[];
  treeIndex: TreeIndex<TData>;
  columnsById: Map<string, AppTreeDataTableColumn<TData>>;
  searchableColumns: AppTreeDataTableColumn<TData>[];
  sorting: SortState;
  searchTokens: string[];
  activeFilters: Record<string, string[]>;
  hasActiveQuery: boolean;
  expandedIds: Set<string>;
}) {
  const sortedChildIds = new Map<string, string[]>();

  function getSortedChildIds(nodeId: string) {
    const cached = sortedChildIds.get(nodeId);
    if (cached) return cached;
    const node = treeIndex.nodes.get(nodeId);
    if (!node) return [];
    const ids = [...node.childIds];
    if (sorting.length > 0) {
      ids.sort((left, right) => sortNodeIds(left, right, columnsById, treeIndex, sorting));
    }
    sortedChildIds.set(nodeId, ids);
    return ids;
  }

  function walk(nodeId: string, depth: number): TreeViewNode<TData> | null {
    const node = treeIndex.nodes.get(nodeId);
    if (!node) return null;

    const rowValues = buildValuesMap(node.row, searchableColumns);
    const directMatch =
      matchesFilters(rowValues, activeFilters) &&
      matchesSearch(rowValues, searchableColumns, searchTokens);

    const childIds = getSortedChildIds(nodeId);

    if (hasActiveQuery) {
      const visibleChildren = childIds
        .map((childId) => walk(childId, depth + 1))
        .filter((child): child is TreeViewNode<TData> => Boolean(child));

      if (!directMatch && visibleChildren.length === 0) return null;

      return {
        ...node,
        depth,
        expanded: visibleChildren.length > 0,
        visibleChildren,
      };
    }

    const isExpanded = expandedIds.has(nodeId);
    const visibleChildren = isExpanded
      ? childIds
          .map((childId) => walk(childId, depth + 1))
          .filter((child): child is TreeViewNode<TData> => Boolean(child))
      : [];

    return {
      ...node,
      depth,
      expanded: isExpanded && node.hasChildren,
      visibleChildren,
    };
  }

  const visibleRoots = rootIds
    .map((rootId) => walk(rootId, 0))
    .filter((root): root is TreeViewNode<TData> => Boolean(root));

  const flatRows = flattenVisibleNodes(visibleRoots);

  return {
    visibleRoots,
    flatRows,
  };
}

function AppTreeDataTableHeader({
  label,
  sorted,
  sortable,
  onSort,
}: {
  label: string;
  sorted: false | "asc" | "desc";
  sortable: boolean;
  onSort?: (event: unknown) => void;
}) {
  if (!sortable || !onSort) return <span>{label}</span>;
  return (
    <button type="button" className="app-tree-data-table__sort" onClick={onSort}>
      {label}
      {sorted === "asc" ? (
        <ArrowUp size={14} />
      ) : sorted === "desc" ? (
        <ArrowDown size={14} />
      ) : (
        <ArrowUpDown size={14} />
      )}
    </button>
  );
}

function getPageSlice<T>(items: T[], pageIndex: number, pageSize: number) {
  const start = pageIndex * pageSize;
  return items.slice(start, start + pageSize);
}

export function AppTreeDataTable<TData>({
  data,
  columns,
  rowId,
  getChildren,
  treeColumnId,
  loading = false,
  error,
  searchable = true,
  selectable = true,
  selectionBehavior = "independent",
  defaultExpandedIds = [],
  expandedIds,
  onExpandedChange,
  expandAllByDefault = false,
  showChildCount = false,
  pageSizes = [10, 20, 50, 100],
  defaultPageSize = 10,
  emptyTitle = "Нет данных",
  emptyDescription = "Измените параметры поиска или добавьте первую запись.",
  bulkActions = [],
  className = "",
  style,
}: AppTreeDataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortState>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [pageIndex, setPageIndex] = useState(0);
  const [density, setDensity] = useState<"compact" | "default" | "comfortable">("default");
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      columns.filter((column) => column.initialHidden).map((column) => [column.id, false]),
    ),
  );
  const [expandedState, setExpandedState] = useState<Set<string>>(
    () => new Set(defaultExpandedIds),
  );
  const [explicitSelection, setExplicitSelection] = useState<Set<string>>(() => new Set());

  const normalizedColumns = useMemo(
    () =>
      columns.map((column) =>
        column.id === treeColumnId ? { ...column, hideable: false, initialHidden: false } : column,
      ),
    [columns, treeColumnId],
  );

  const columnsById = useMemo(
    () => new Map(normalizedColumns.map((column) => [column.id, column] as const)),
    [normalizedColumns],
  );
  const treeColumn = columnsById.get(treeColumnId) ?? normalizedColumns[0];
  const visibleColumns = useMemo(
    () =>
      normalizedColumns.filter(
        (column) => columnVisibility[column.id] !== false || column.id === treeColumnId,
      ),
    [columnVisibility, normalizedColumns, treeColumnId],
  );
  const filterableColumns = useMemo(
    () =>
      normalizedColumns.filter(
        (column) => column.filterable && (column.filterOptions?.length ?? 0) > 0,
      ),
    [normalizedColumns],
  );
  const searchableColumns = useMemo(
    () => normalizedColumns.filter((column) => column.accessor || column.value),
    [normalizedColumns],
  );

  const treeIndex = useMemo(
    () => buildTreeIndex({ data, rowId, getChildren }),
    [data, rowId, getChildren],
  );

  const allExpandableIds = treeIndex.expandableIds;
  const activeFilterCount = Object.values(columnFilters).filter(
    (values) => values.length > 0,
  ).length;
  const searchTokens = useMemo(
    () => normalizeSearchValue(deferredSearch).split(/\s+/).filter(Boolean),
    [deferredSearch],
  );
  const hasActiveQuery = searchTokens.length > 0 || activeFilterCount > 0;
  const userExpandedIds = expandedIds ? new Set(expandedIds) : expandedState;
  const visibleExpandedIds = useMemo(
    () => (expandAllByDefault && !hasActiveQuery ? new Set(allExpandableIds) : userExpandedIds),
    [allExpandableIds, expandAllByDefault, hasActiveQuery, userExpandedIds],
  );

  const selectionStateById = useMemo(() => {
    const states = new Map<string, SelectionState>();

    function visit(nodeId: string): SelectionState {
      const cached = states.get(nodeId);
      if (cached) return cached;
      const node = treeIndex.nodes.get(nodeId);
      if (!node) {
        const fallback = { selected: false, indeterminate: false, selectedIds: [] as string[] };
        states.set(nodeId, fallback);
        return fallback;
      }

      if (selectionBehavior === "independent" || !node.hasChildren) {
        const selected = explicitSelection.has(nodeId);
        const next = {
          selected,
          indeterminate: false,
          selectedIds: selected ? [nodeId] : [],
        };
        states.set(nodeId, next);
        return next;
      }

      const childStates = node.childIds.map((childId) => visit(childId));
      const childSelectedIds = childStates.flatMap((state) => state.selectedIds);
      const hasSelectedChildren = childStates.some(
        (state) => state.selected || state.indeterminate,
      );
      const allChildrenSelected =
        node.childIds.length > 0 &&
        childStates.every((state) => state.selected && !state.indeterminate);
      const selfExplicit = explicitSelection.has(nodeId);
      const selected = selfExplicit || allChildrenSelected;
      const indeterminate = !selected && hasSelectedChildren;
      const next = {
        selected,
        indeterminate,
        selectedIds: selected ? unique([nodeId, ...childSelectedIds]) : unique(childSelectedIds),
      };
      states.set(nodeId, next);
      return next;
    }

    for (const rootId of treeIndex.rootIds) visit(rootId);
    return states;
  }, [explicitSelection, selectionBehavior, treeIndex]);

  const selectedIds = useMemo(
    () => treeIndex.rootIds.flatMap((rootId) => selectionStateById.get(rootId)?.selectedIds ?? []),
    [selectionStateById, treeIndex.rootIds],
  );
  const selectedRows = useMemo(
    () =>
      selectedIds
        .map((id) => treeIndex.nodes.get(id)?.row)
        .filter((row): row is TData => row !== undefined),
    [selectedIds, treeIndex.nodes],
  );

  const visibleTree = useMemo(
    () =>
      buildVisibleTree({
        rootIds: treeIndex.rootIds,
        treeIndex,
        columnsById,
        searchableColumns,
        sorting,
        searchTokens,
        activeFilters: columnFilters,
        hasActiveQuery,
        expandedIds: visibleExpandedIds,
      }),
    [
      columnFilters,
      columnsById,
      searchTokens,
      searchableColumns,
      sorting,
      treeIndex,
      visibleExpandedIds,
    ],
  );

  const filteredRoots = visibleTree.visibleRoots;
  const visibleRows = visibleTree.flatRows;
  const pageCount = Math.max(1, Math.ceil(filteredRoots.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageRoots = getPageSlice(filteredRoots, safePageIndex, pageSize);
  const pageRows = flattenVisibleNodes(pageRoots);
  const visibleColumnCount = (selectable ? 1 : 0) + visibleColumns.length;
  const pages = pageNumbers(safePageIndex, pageCount);

  const activeFilters = activeFilterCount + (searchTokens.length > 0 ? 1 : 0);
  const hasAnyChildren = allExpandableIds.length > 0;
  const totalVisibleRoots = filteredRoots.length;
  const totalVisibleRows = visibleRows.length;
  const pageSelectionIds = useMemo(() => {
    if (!selectable) return [];
    return pageRoots.flatMap((root) => collectSubtreeIds(root.id, treeIndex));
  }, [pageRoots, selectable, treeIndex]);
  const sortingById = useMemo(
    () => new Map(sorting.map((item) => [item.id, item] as const)),
    [sorting],
  );

  function setExpandedIds(nextIds: string[]) {
    if (expandedIds) {
      onExpandedChange?.(nextIds);
      return;
    }
    setExpandedState(new Set(nextIds));
  }

  function toggleExpanded(id: string) {
    const next = new Set(userExpandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds([...next]);
  }

  function expandAll() {
    setExpandedIds(allExpandableIds);
  }

  function collapseAll() {
    setExpandedIds([]);
  }

  function clearFilters() {
    setSearch("");
    setColumnFilters({});
    setPageIndex(0);
  }

  function toggleSort(columnId: string, shiftKey: boolean) {
    setSorting((current) => {
      const existingIndex = current.findIndex((item) => item.id === columnId);
      const existing = current[existingIndex];
      const next = shiftKey ? [...current] : [];

      if (!existing) {
        next.push({ id: columnId, desc: false });
        return next;
      }

      if (existing.desc === false) {
        const updated = { id: columnId, desc: true };
        if (shiftKey) next[existingIndex] = updated;
        else next.push(updated);
        return next;
      }

      if (shiftKey) {
        next.splice(existingIndex, 1);
        return next;
      }

      return [];
    });
  }

  function toggleSelection(nodeId: string) {
    const node = treeIndex.nodes.get(nodeId);
    if (!node) return;

    if (selectionBehavior === "independent") {
      const next = new Set(explicitSelection);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      setExplicitSelection(next);
      return;
    }

    const closureIds = collectSubtreeIds(nodeId, treeIndex);
    const currentState = selectionStateById.get(nodeId);
    const shouldSelect = !currentState?.selected;
    const next = new Set(explicitSelection);

    for (const id of closureIds) {
      if (shouldSelect) next.add(id);
      else next.delete(id);
    }

    setExplicitSelection(next);
  }

  function collectSubtreeIds(startId: string, index: TreeIndex<TData>) {
    const stack = [startId];
    const result: string[] = [];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id) continue;
      result.push(id);
      const node = index.nodes.get(id);
      if (!node) continue;
      for (const childId of node.childIds.slice().reverse()) stack.push(childId);
    }
    return result;
  }

  function renderCell(
    row: TData,
    column: AppTreeDataTableColumn<TData>,
    context: AppTreeDataTableCellContext,
  ) {
    if (column.cell) return column.cell(row, context);
    const value = getColumnValue(row, column);
    return value == null || value === "" ? "—" : String(value);
  }

  function renderTreeCell(node: TreeViewNode<TData>) {
    const column = treeColumn;
    const context: AppTreeDataTableCellContext = {
      depth: node.depth,
      hasChildren: node.hasChildren,
      expanded: node.expanded,
    };
    const content = renderCell(node.row, column, context);
    const directChildren = node.childIds.length;

    return (
      <div
        className="app-tree-data-table__tree-cell"
        style={{ "--tree-depth": node.depth } as CSSProperties}
      >
        {node.hasChildren ? (
          <button
            type="button"
            className="app-tree-data-table__expander"
            aria-label={`Развернуть строку: ${String(getColumnValue(node.row, column) ?? node.id)}`}
            aria-expanded={node.expanded}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(node.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                if (!node.expanded) toggleExpanded(node.id);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                if (node.expanded) toggleExpanded(node.id);
              }
            }}
          >
            {node.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="app-tree-data-table__expander app-tree-data-table__expander--spacer" />
        )}
        <span className="app-tree-data-table__tree-main">
          {node.hasChildren && <Folder size={15} className="app-tree-data-table__tree-icon" />}
          <span className="app-tree-data-table__tree-content">{content}</span>
          {showChildCount && node.hasChildren && (
            <AppBadge tone="slate" className="app-tree-data-table__count">
              {directChildren}
            </AppBadge>
          )}
        </span>
      </div>
    );
  }

  function buildVisibleCell(node: TreeViewNode<TData>, column: AppTreeDataTableColumn<TData>) {
    const context: AppTreeDataTableCellContext = {
      depth: node.depth,
      hasChildren: node.hasChildren,
      expanded: node.expanded,
    };
    const content = renderCell(node.row, column, context);

    if (column.id === treeColumnId) {
      return renderTreeCell(node);
    }

    return content;
  }

  return (
    <div className={`app-tree-data-table density-${density} ${className}`.trim()} style={style}>
      <div className="app-tree-data-table__toolbar">
        <div className="app-tree-data-table__toolbar-main">
          <div className="app-tree-data-table__filters-row">
            {searchable && (
              <div className="app-tree-data-table__search-wrap">
                <AppSearchInput
                  aria-label="Поиск по дереву"
                  placeholder="Поиск по дереву..."
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPageIndex(0);
                  }}
                />
              </div>
            )}

            {filterableColumns.map((column) => (
              <div className="app-tree-data-table__filter" key={column.id}>
                <AppSelect
                  options={column.filterOptions ?? []}
                  value={columnFilters[column.id] ?? []}
                  multiple
                  searchable
                  clearable
                  showSelectedTags={false}
                  multipleValueDisplay="count"
                  placeholder={column.header}
                  onValueChange={(value) => {
                    const next = value as string[];
                    setColumnFilters((current) => {
                      const nextFilters = { ...current };
                      if (next.length === 0) delete nextFilters[column.id];
                      else nextFilters[column.id] = next;
                      return nextFilters;
                    });
                    setPageIndex(0);
                  }}
                />
              </div>
            ))}
          </div>

          {activeFilters > 0 && (
            <AppButton
              variant="ghost"
              className="app-tree-data-table__clear"
              onClick={clearFilters}
            >
              <X size={16} />
              Сбросить ({activeFilters})
            </AppButton>
          )}
        </div>

        <div className="app-tree-data-table__tools">
          {hasAnyChildren && (
            <>
              <AppTooltip content="Развернуть все">
                <AppButton
                  type="button"
                  variant="secondary"
                  className="app-tree-data-table__tool-button app-tree-data-table__icon-button"
                  aria-label="Развернуть все"
                  onClick={expandAll}
                >
                  <ChevronsDown size={18} />
                </AppButton>
              </AppTooltip>
              <AppTooltip content="Свернуть все">
                <AppButton
                  type="button"
                  variant="secondary"
                  className="app-tree-data-table__tool-button app-tree-data-table__icon-button"
                  aria-label="Свернуть все"
                  onClick={collapseAll}
                >
                  <ChevronsUp size={18} />
                </AppButton>
              </AppTooltip>
            </>
          )}

          <DropdownMenu>
            <AppTooltip content="Настроить колонки">
              <DropdownMenuTrigger asChild>
                <AppButton
                  type="button"
                  variant="secondary"
                  className="app-tree-data-table__tool-button app-tree-data-table__icon-button"
                  aria-label="Настроить колонки"
                >
                  <Columns3 size={18} />
                </AppButton>
              </DropdownMenuTrigger>
            </AppTooltip>
            <DropdownMenuContent align="end">
              {normalizedColumns
                .filter((column) => column.id !== treeColumnId && (column.hideable ?? true))
                .map((column) => (
                  <DropdownMenuItem
                    key={column.id}
                    onSelect={(event) => {
                      event.preventDefault();
                      setColumnVisibility((current) => ({
                        ...current,
                        [column.id]: current[column.id] === false,
                      }));
                    }}
                  >
                    <Checkbox
                      checked={columnVisibility[column.id] !== false}
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                    {column.header}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <AppTooltip content="Плотность строк">
              <DropdownMenuTrigger asChild>
                <AppButton
                  type="button"
                  variant="secondary"
                  className="app-tree-data-table__tool-button app-tree-data-table__icon-button"
                  aria-label="Плотность строк"
                >
                  <Rows3 size={18} />
                </AppButton>
              </DropdownMenuTrigger>
            </AppTooltip>
            <DropdownMenuContent align="end">
              {(
                [
                  ["compact", "Компактно"],
                  ["default", "Стандартно"],
                  ["comfortable", "Просторно"],
                ] as const
              ).map(([value, label]) => (
                <DropdownMenuItem key={value} onSelect={() => setDensity(value)}>
                  <span
                    className={`app-tree-data-table__density-dot ${density === value ? "active" : ""}`}
                  />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {selectable && selectedRows.length > 0 && (
        <div className="app-tree-data-table__bulk">
          <strong>Выбрано: {selectedRows.length}</strong>
          <div>
            {bulkActions.map((action) => (
              <button
                type="button"
                key={action.label}
                className={action.tone === "danger" ? "danger" : ""}
                onClick={() => action.onSelect(selectedRows)}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
            <button type="button" onClick={() => setExplicitSelection(new Set())}>
              Отменить выбор
            </button>
          </div>
        </div>
      )}

      <div className="app-tree-data-table__scroll">
        <table className="app-tree-data-table__table" role="treegrid">
          <thead>
            <tr role="row">
              {selectable && (
                <th className="app-tree-data-table__selection-head" scope="col">
                  <Checkbox
                    aria-label="Выбрать все строки"
                    checked={
                      pageSelectionIds.length > 0 &&
                      pageSelectionIds.every((id) => selectedIds.includes(id))
                        ? true
                        : pageSelectionIds.some((id) => selectedIds.includes(id))
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) => {
                      const shouldSelect = checked === true;
                      if (!shouldSelect) {
                        setExplicitSelection(new Set());
                        return;
                      }
                      const next = new Set<string>();
                      for (const root of pageRoots) {
                        for (const id of collectSubtreeIds(root.id, treeIndex)) next.add(id);
                      }
                      setExplicitSelection(next);
                    }}
                  />
                </th>
              )}
              {visibleColumns.map((column) => {
                const isTreeColumn = column.id === treeColumnId;
                const sortedColumn = sortingById.get(column.id);
                const sorted = sortedColumn ? (sortedColumn.desc ? "desc" : "asc") : false;
                return (
                  <th
                    key={column.id}
                    className={`align-${column.align ?? "left"}${isTreeColumn ? " is-tree" : ""}`}
                    style={column.width ? { width: column.width } : undefined}
                    scope="col"
                  >
                    <AppTreeDataTableHeader
                      label={column.header}
                      sorted={sorted}
                      sortable={column.sortable ?? false}
                      onSort={(event) => {
                        const mouseEvent = event as { shiftKey?: boolean };
                        toggleSort(column.id, Boolean(mouseEvent?.shiftKey));
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: Math.min(defaultPageSize, 6) }).map((_, rowIndex) => (
                <tr key={`loading-${rowIndex}`} role="row">
                  {selectable && (
                    <td role="gridcell">
                      <span className="app-tree-data-table__skeleton app-tree-data-table__skeleton--checkbox" />
                    </td>
                  )}
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      role="gridcell"
                      className={`align-${column.align ?? "left"}`}
                    >
                      <span
                        className="app-tree-data-table__skeleton"
                        style={
                          column.id === treeColumnId
                            ? ({ "--skeleton-depth": rowIndex % 3 } as CSSProperties)
                            : undefined
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && error && (
              <tr role="row">
                <td colSpan={visibleColumnCount} role="gridcell">
                  <div className="app-tree-data-table__state error">
                    <ListFilter size={28} />
                    <strong>Не удалось загрузить данные</strong>
                    <span>{error}</span>
                  </div>
                </td>
              </tr>
            )}

            {!loading && !error && pageRows.length === 0 && (
              <tr role="row">
                <td colSpan={visibleColumnCount} role="gridcell">
                  <div className="app-tree-data-table__state">
                    <ListFilter size={28} />
                    <strong>{hasActiveQuery ? "Ничего не найдено" : emptyTitle}</strong>
                    <span>
                      {hasActiveQuery ? "Измените поиск или сбросьте фильтры." : emptyDescription}
                    </span>
                  </div>
                </td>
              </tr>
            )}

            {!loading &&
              !error &&
              pageRows.map((node) => {
                const selectionState = selectionStateById.get(node.id) ?? {
                  selected: false,
                  indeterminate: false,
                };
                return (
                  <tr
                    key={node.id}
                    role="row"
                    aria-level={node.depth + 1}
                    aria-expanded={node.hasChildren ? node.expanded : undefined}
                    data-selected={selectionState.selected || undefined}
                    data-indeterminate={selectionState.indeterminate || undefined}
                  >
                    {selectable && (
                      <td
                        role="gridcell"
                        className="app-tree-data-table__selection-cell"
                        data-label=""
                      >
                        <Checkbox
                          aria-label="Выбрать строку"
                          checked={
                            selectionBehavior === "cascade" && selectionState.indeterminate
                              ? "indeterminate"
                              : selectionState.selected
                          }
                          onCheckedChange={() => toggleSelection(node.id)}
                        />
                      </td>
                    )}
                    {visibleColumns.map((column) => (
                      <td
                        key={column.id}
                        role="gridcell"
                        className={`align-${column.align ?? "left"}${
                          column.id === treeColumnId ? " is-tree" : ""
                        }`}
                        data-label={column.header}
                        style={column.width ? { width: column.width } : undefined}
                      >
                        {buildVisibleCell(node, column)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="app-tree-data-table__footer">
        <span>
          {totalVisibleRows
            ? `${Math.min(pageSize, Math.max(0, totalVisibleRoots - safePageIndex * pageSize))} корневых · ${totalVisibleRows} записей всего`
            : "0 записей"}
        </span>

        <div className="app-tree-data-table__page-size">
          <span>Строк:</span>
          <AppSelect
            options={pageSizes.map((size) => ({ value: String(size), label: String(size) }))}
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPageIndex(0);
            }}
          />
        </div>

        <div className="app-tree-data-table__pagination">
          <button
            type="button"
            disabled={pageIndex <= 0}
            onClick={() => setPageIndex(0)}
            aria-label="Первая страница"
          >
            <ChevronsLeft size={17} />
          </button>
          <button
            type="button"
            disabled={pageIndex <= 0}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            aria-label="Предыдущая страница"
          >
            <ChevronLeft size={17} />
          </button>
          {pages.map((page, index) => (
            <span key={page} className="app-tree-data-table__page-item">
              {index > 0 && page - pages[index - 1] > 1 && <i>…</i>}
              <button
                type="button"
                className={page === safePageIndex ? "active" : ""}
                onClick={() => setPageIndex(page)}
              >
                {page + 1}
              </button>
            </span>
          ))}
          <button
            type="button"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
            aria-label="Следующая страница"
          >
            <ChevronRight size={17} />
          </button>
          <button
            type="button"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex(Math.max(0, pageCount - 1))}
            aria-label="Последняя страница"
          >
            <ChevronsRight size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
