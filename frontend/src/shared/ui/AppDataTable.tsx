import {
  CSSProperties,
  Fragment,
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ColumnDef,
  Row,
  RowSelectionState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  ListFilter,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppButton } from "@/shared/ui/AppButton";
import { AppContextMenu, type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppModal, AppTooltip } from "@/shared/ui/AppFeedback";
import { AppSelect, type AppSelectOption } from "@/shared/ui/AppField";
import { adminSearchVariants, normalizeAdminSearchText } from "@/shared/lib/adminSearch";
import "./AppDataTable.css";

export type AppDataTableDensity = "compact" | "default" | "comfortable";

export type AppDataTableColumn<TData> = {
  id: string;
  header: string;
  accessor?: keyof TData & string;
  value?: (row: TData) => unknown;
  cell?: (row: TData) => ReactNode;
  /** Include this column in the built-in client-side full-text search. */
  searchable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  filterOptions?: AppSelectOption[];
  align?: "left" | "center" | "right";
  hideable?: boolean;
  initialHidden?: boolean;
  width?: number;
};

export type AppTableBulkAction<TData> = {
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  onSelect: (rows: TData[]) => void;
};

export type AppDataTableFilterValues = Record<string, string[]>;

export type AppDataTableGroup<TData> = {
  id: string;
  rows: TData[];
  collapsed: boolean;
};

const REMOTE_SEARCH_DEBOUNCE_MS = 500;

export type AppDataTableProps<TData> = {
  className?: string;
  data: TData[];
  columns: AppDataTableColumn<TData>[];
  rowId: (row: TData) => string;
  /** Adds a semantic CSS class to a rendered data row. */
  rowClassName?: (row: TData) => string | undefined;
  /** Supplies native props for a rendered data row, for example drag-and-drop handlers. */
  rowProps?: (row: TData) => HTMLAttributes<HTMLTableRowElement> | undefined;
  /** Handles a click on a data row. Interactive elements inside a row keep their native action. */
  onRowClick?: (row: TData) => void;
  /** Handles a double click on a data row. Interactive elements inside a row keep their native action. */
  onRowDoubleClick?: (row: TData) => void;
  /** Handles a right click on a data row. Interactive elements inside a row keep their native action. */
  onRowContextMenu?: (row: TData, event: MouseEvent<HTMLTableRowElement>) => void;
  /** Supplies the same row actions for a contextual menu opened with the right mouse button. */
  contextMenuActions?: (row: TData) => AppContextMenuAction[];
  /** Supplies an accessible label for the contextual menu. */
  contextMenuLabel?: (row: TData) => string;
  /** Renders a full-width detail row directly below the selected data row. */
  renderExpandedRow?: (row: TData) => ReactNode;
  /** Controlled identifier of the row whose detail is expanded. */
  expandedRowId?: string | null;
  /** Initial expanded row identifier for uncontrolled usage. */
  defaultExpandedRowId?: string | null;
  /** Reports the expanded row identifier after a row click. */
  onExpandedRowIdChange?: (rowId: string | null, row: TData | null) => void;
  /** Returns a group key for a row. Group headers are rendered before consecutive rows. */
  groupBy?: (row: TData) => string | null | undefined;
  /** Groups whose data rows are temporarily hidden while their header remains visible. */
  collapsedGroupIds?: ReadonlySet<string>;
  /** Renders a full-width header for a group. Group headers are unavailable in virtual mode. */
  renderGroupHeader?: (group: AppDataTableGroup<TData>) => ReactNode;
  /** Adds a semantic CSS class to a rendered group-header row. */
  groupRowClassName?: (group: AppDataTableGroup<TData>) => string | undefined;
  /** Compact content below 640px. Non-virtualized tables only; renderer owns card fields/visibility. */
  renderMobileRow?: (row: TData) => ReactNode;
  /** Moves filters and table settings into a labelled dialog on mobile. */
  mobileFilterDialog?: boolean;
  /** Removable tags for page-owned toolbar filters in the compact mobile toolbar. */
  mobileToolbarFilterTags?: ReactNode;
  /** Restores both axes of the table's internal scroll container once data is ready. */
  initialScrollPosition?: { top: number; left: number };
  onScrollPositionChange?: (position: { top: number; left: number }) => void;
  loading?: boolean;
  error?: string;
  searchable?: boolean;
  /** Explains which data is included in the table search. */
  searchPlaceholder?: string;
  selectable?: boolean;
  /** Limits which rows can be selected when `selectable` is enabled. */
  canSelectRow?: (row: TData) => boolean;
  /** Controlled row-selection state. Selection is retained by the caller across filtering. */
  rowSelection?: RowSelectionState;
  /** Reports row-selection changes for controlled table selection. */
  onRowSelectionChange?: (value: RowSelectionState) => void;
  /** Hides the built-in selected-row summary when selection actions are rendered externally. */
  showSelectionSummary?: boolean;
  pageSizes?: number[];
  defaultPageSize?: number;
  /** Initial client-side page (one-based). Ignored in server and infinite modes. */
  initialPage?: number;
  /** Initial client-side search text. Changes after mounting stay inside the table. */
  initialSearchValue?: string;
  /** Initial client-side column filters. Changes after mounting stay inside the table. */
  initialFilterValues?: AppDataTableFilterValues;
  /** Initial client-side sorting. Changes after mounting stay inside the table. */
  initialSortingState?: SortingState;
  /** Initial client-side density. Changes after mounting stay inside the table. */
  initialDensity?: AppDataTableDensity;
  /** Initial client-side column visibility. Changes after mounting stay inside the table. */
  initialColumnVisibility?: VisibilityState;
  /** Disable numbered pagination for a client-side table and render the full filtered row set. */
  pagination?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  bulkActions?: AppTableBulkAction<TData>[];
  mode?: "client" | "server" | "infinite";
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  toolbarFilters?: ReactNode;
  activeToolbarFilters?: number;
  onClearToolbarFilters?: () => void;
  filterValues?: AppDataTableFilterValues;
  onFilterValuesChange?: (value: AppDataTableFilterValues) => void;
  sortingState?: SortingState;
  onSortingStateChange?: (value: SortingState) => void;
  density?: AppDataTableDensity;
  onDensityChange?: (value: AppDataTableDensity) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (value: VisibilityState) => void;
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  virtualized?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreError?: string;
  onLoadMore?: () => void;
  onRetryLoadMore?: () => void;
  scrollHeight?: number;
  rowHeight?: number;
  overscan?: number;
  loadMoreThreshold?: number;
};

function pageNumbers(pageIndex: number, pageCount: number) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  const values = new Set([0, pageCount - 1, pageIndex - 1, pageIndex, pageIndex + 1]);
  return [...values].filter((page) => page >= 0 && page < pageCount).sort((a, b) => a - b);
}

function getSearchScore<TData>(
  row: TData,
  columns: AppDataTableColumn<TData>[],
  tokenVariants: string[][],
) {
  const fields = columns
    .filter((column) => column.searchable !== false && (column.accessor || column.value))
    .map((column) =>
      normalizeAdminSearchText(
        String(column.value ? column.value(row) : column.accessor ? row[column.accessor] : ""),
      ),
    )
    .filter(Boolean);
  const words = fields.flatMap((field) => field.split(/\s+/));
  let matchedTokens = 0;
  let relevance = 0;

  for (const variants of tokenVariants) {
    const exactWord = variants.some((variant) => words.some((word) => word === variant));
    const suffixField = variants.some((variant) => fields.some((field) => field.endsWith(variant)));
    const prefixWord = variants.some((variant) => words.some((word) => word.startsWith(variant)));
    const includes = variants.some((variant) => fields.some((field) => field.includes(variant)));

    if (exactWord || prefixWord || includes) {
      matchedTokens += 1;
      relevance += exactWord ? 100 : suffixField ? 80 : prefixWord ? 60 : 25;
    }
  }

  return {
    matchedTokens,
    score: matchedTokens * 1000 + relevance,
  };
}

function AppDataTableHeader({
  label,
  sorted,
  sortable,
  onSort,
}: {
  label: string;
  sorted: false | "asc" | "desc";
  sortable: boolean;
  onSort?: () => void;
}) {
  if (!sortable || !onSort) return <span>{label}</span>;
  return (
    <button type="button" className="app-data-table__sort" onClick={onSort}>
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

function nextSortingState(current: SortingState, columnId: string) {
  const currentValue = current.find((item) => item.id === columnId);
  if (!currentValue) return [{ id: columnId, desc: false }];
  if (!currentValue.desc) return [{ id: columnId, desc: true }];
  return [];
}

function buildColumnFilterState(filterValues: AppDataTableFilterValues) {
  return Object.entries(filterValues).reduce<Record<string, string[]>>((acc, [key, value]) => {
    if (value.length > 0) acc[key] = value;
    return acc;
  }, {});
}

export function AppDataTable<TData>({
  className,
  data,
  columns,
  rowId,
  rowClassName,
  rowProps,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  contextMenuActions,
  contextMenuLabel,
  renderExpandedRow,
  expandedRowId,
  defaultExpandedRowId = null,
  onExpandedRowIdChange,
  groupBy,
  collapsedGroupIds,
  renderGroupHeader,
  groupRowClassName,
  renderMobileRow,
  mobileFilterDialog = false,
  mobileToolbarFilterTags,
  initialScrollPosition,
  onScrollPositionChange,
  loading = false,
  error,
  searchable = true,
  searchPlaceholder = "Поиск по таблице...",
  selectable = true,
  canSelectRow,
  rowSelection,
  onRowSelectionChange,
  showSelectionSummary = true,
  pageSizes = [10, 20, 50, 100],
  defaultPageSize = 10,
  initialPage = 1,
  initialSearchValue = "",
  initialFilterValues,
  initialSortingState = [],
  initialDensity = "default",
  initialColumnVisibility,
  pagination = true,
  emptyTitle = "Нет данных",
  emptyDescription = "Измените параметры поиска или добавьте первую запись.",
  bulkActions = [],
  mode = "client",
  searchValue,
  onSearchChange,
  toolbarFilters,
  activeToolbarFilters = 0,
  onClearToolbarFilters,
  filterValues,
  onFilterValuesChange,
  sortingState,
  onSortingStateChange,
  density,
  onDensityChange,
  columnVisibility,
  onColumnVisibilityChange,
  page = 1,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
  virtualized = false,
  hasMore = false,
  loadingMore = false,
  loadMoreError,
  onLoadMore,
  onRetryLoadMore,
  scrollHeight: virtualScrollHeight = 420,
  rowHeight,
  overscan = 5,
  loadMoreThreshold = 120,
}: AppDataTableProps<TData>) {
  const isInfiniteMode = mode === "infinite";
  const isServerMode = mode === "server" || isInfiniteMode;
  const isUnpaginatedClientMode = mode === "client" && !pagination;
  const [localSorting, setLocalSorting] = useState<SortingState>(initialSortingState);
  const [localSearch, setLocalSearch] = useState(initialSearchValue);
  const [localSearchInput, setLocalSearchInput] = useState(initialSearchValue);
  const [remoteSearchInput, setRemoteSearchInput] = useState(searchValue ?? "");
  const [localFilterValues, setLocalFilterValues] = useState<AppDataTableFilterValues>(() =>
    buildColumnFilterState(initialFilterValues ?? {}),
  );
  const [localRowSelection, setLocalRowSelection] = useState<RowSelectionState>({});
  const selectedRowsSnapshotRef = useRef(new Map<string, TData>());
  const [localDensity, setLocalDensity] = useState<AppDataTableDensity>(initialDensity);
  const [scrollTop, setScrollTop] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const scrollPositionRestoredRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRequestedRef = useRef(false);
  const [localColumnVisibility, setLocalColumnVisibility] = useState<VisibilityState>(
    () =>
      ({
        ...Object.fromEntries(
          columns.filter((column) => column.initialHidden).map((column) => [column.id, false]),
        ),
        ...initialColumnVisibility,
      }) as VisibilityState,
  );
  const [localExpandedRowId, setLocalExpandedRowId] = useState<string | null>(defaultExpandedRowId);
  const [contextMenu, setContextMenu] = useState<{
    row: TData;
    x: number;
    y: number;
  } | null>(null);
  const onSearchChangeRef = useRef(onSearchChange);
  const onPageChangeRef = useRef(onPageChange);

  const usesExternalSearch = isServerMode;
  const usesExternalFilters = isServerMode;
  const usesExternalSorting = isServerMode;
  const currentSorting = usesExternalSorting ? (sortingState ?? []) : localSorting;
  const currentDensity = density ?? localDensity;
  const currentColumnVisibility = columnVisibility ?? localColumnVisibility;
  const currentSearch = usesExternalSearch ? (searchValue ?? "") : localSearch;
  const visibleSearch = usesExternalSearch ? remoteSearchInput : localSearchInput;
  const currentFilterValues = usesExternalFilters
    ? buildColumnFilterState(filterValues ?? {})
    : localFilterValues;
  const currentRowSelection = rowSelection ?? localRowSelection;
  const currentPage = isServerMode ? page : 1;
  const serverPageSize = pageSize ?? defaultPageSize;
  const searchTokenVariants = useMemo(
    () =>
      currentSearch
        .trim()
        .split(/\s+/)
        .map((token) => adminSearchVariants(token))
        .filter((variants) => variants.length > 0),
    [currentSearch],
  );

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);

  useEffect(() => {
    if (!usesExternalSearch) return;
    setRemoteSearchInput(searchValue ?? "");
  }, [searchValue, usesExternalSearch]);

  useEffect(() => {
    if (isServerMode || localSearchInput === localSearch) return;

    const timeoutId = window.setTimeout(() => {
      setLocalSearch(localSearchInput);
      onSearchChangeRef.current?.(localSearchInput);
    }, REMOTE_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isServerMode, localSearch, localSearchInput]);

  useEffect(() => {
    const savedSearch = searchValue ?? "";
    if (!usesExternalSearch || !onSearchChangeRef.current || remoteSearchInput === savedSearch) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onSearchChangeRef.current?.(remoteSearchInput);
      onPageChangeRef.current?.(1);
    }, REMOTE_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [remoteSearchInput, searchValue, usesExternalSearch]);

  const rankedData = useMemo(() => {
    if (isServerMode) return data;
    if (searchTokenVariants.length === 0) return data;

    return data
      .map((row, index) => ({
        row,
        index,
        ...getSearchScore(row, columns, searchTokenVariants),
      }))
      .filter((item) => item.matchedTokens > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((item) => item.row);
  }, [columns, data, isServerMode, searchTokenVariants]);

  const clientFilteredData = useMemo(() => {
    if (isServerMode) return data;
    return rankedData.filter((row) =>
      Object.entries(currentFilterValues).every(([columnId, values]) => {
        if (values.length === 0) return true;
        const column = columns.find((item) => item.id === columnId);
        if (!column) return true;
        const rawValue = column.value
          ? column.value(row)
          : column.accessor
            ? row[column.accessor]
            : undefined;
        return values.includes(String(rawValue ?? ""));
      }),
    );
  }, [columns, currentFilterValues, data, isServerMode, rankedData]);

  const tableColumns = useMemo<ColumnDef<TData>[]>(
    () => [
      ...(selectable
        ? [
            {
              id: "__select",
              enableSorting: false,
              enableHiding: false,
              header: ({ table }) => (
                <Checkbox
                  aria-label={
                    isInfiniteMode
                      ? "Выбрать загруженные строки"
                      : isUnpaginatedClientMode
                        ? "Выбрать все строки"
                        : "Выбрать строки на странице"
                  }
                  checked={
                    table.getIsAllPageRowsSelected() ||
                    (table.getIsSomePageRowsSelected() ? "indeterminate" : false)
                  }
                  onCheckedChange={(checked) => table.toggleAllPageRowsSelected(Boolean(checked))}
                />
              ),
              cell: ({ row }: { row: Row<TData> }) => (
                <Checkbox
                  aria-label={`Выбрать строку ${row.id}`}
                  checked={row.getIsSelected()}
                  disabled={!row.getCanSelect()}
                  onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
                />
              ),
              meta: { align: "left", label: "", width: 56 },
            } satisfies ColumnDef<TData>,
          ]
        : []),
      ...columns.map(
        (column) =>
          ({
            id: column.id,
            accessorKey: column.accessor,
            accessorFn: column.value,
            enableSorting: column.sortable ?? false,
            enableHiding: column.hideable ?? true,
            header: ({ column: tableColumn }) => (
              <AppDataTableHeader
                label={column.header}
                sorted={tableColumn.getIsSorted()}
                sortable={column.sortable ?? false}
                onSort={() => {
                  const next = nextSortingState(currentSorting, column.id);
                  if (usesExternalSorting) onSortingStateChange?.(next);
                  else {
                    setLocalSorting(next);
                    onSortingStateChange?.(next);
                  }
                  if (isServerMode) {
                    onPageChange?.(1);
                  } else {
                    table.setPageIndex(0);
                    onPageChange?.(1);
                  }
                }}
              />
            ),
            cell: ({ row, getValue }) =>
              column.cell ? column.cell(row.original) : String(getValue() ?? "—"),
            meta: {
              align: column.align ?? "left",
              label: column.header,
              width: column.width,
            },
          }) satisfies ColumnDef<TData>,
      ),
    ],
    [
      columns,
      canSelectRow,
      currentSorting,
      isInfiniteMode,
      isUnpaginatedClientMode,
      isServerMode,
      onPageChange,
      onSortingStateChange,
      selectable,
      usesExternalSorting,
    ],
  );

  const currentRowsById = useMemo(
    () => new Map(data.map((row) => [rowId(row), row] as const)),
    [data, rowId],
  );

  const handleRowSelectionChange = useCallback(
    (updater: RowSelectionState | ((current: RowSelectionState) => RowSelectionState)) => {
      const apply = (current: RowSelectionState) => {
        const next = typeof updater === "function" ? updater(current) : updater;

        Object.entries(next).forEach(([id, selected]) => {
          if (!selected) return;
          const currentRow = currentRowsById.get(id);
          if (currentRow) selectedRowsSnapshotRef.current.set(id, currentRow);
        });
        selectedRowsSnapshotRef.current.forEach((_, id) => {
          if (!next[id]) selectedRowsSnapshotRef.current.delete(id);
        });

        return next;
      };

      if (rowSelection !== undefined) {
        onRowSelectionChange?.(apply(currentRowSelection));
        return;
      }

      setLocalRowSelection((current) => {
        const next = apply(current);
        onRowSelectionChange?.(next);
        return next;
      });
    },
    [currentRowSelection, currentRowsById, onRowSelectionChange, rowSelection],
  );

  const table = useReactTable({
    data: isServerMode ? data : clientFilteredData,
    columns: tableColumns,
    state: {
      sorting: currentSorting,
      rowSelection: currentRowSelection,
      columnVisibility: currentColumnVisibility,
    },
    ...(isServerMode
      ? {
          manualPagination: true,
          manualSorting: true,
          pageCount: Math.max(totalPages ?? 1, 1),
        }
      : {
          getFilteredRowModel: getFilteredRowModel(),
          getSortedRowModel: getSortedRowModel(),
          ...(pagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
        }),
    initialState: {
      pagination: {
        pageIndex: Math.max(initialPage - 1, 0),
        pageSize: defaultPageSize,
      },
    },
    getRowId: (row) => rowId(row),
    enableRowSelection: (row) => selectable && (canSelectRow?.(row.original) ?? true),
    onRowSelectionChange: handleRowSelectionChange,
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(currentColumnVisibility) : updater;
      if (columnVisibility !== undefined) onColumnVisibilityChange?.(next);
      else {
        setLocalColumnVisibility(next);
        onColumnVisibilityChange?.(next);
      }
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const clientSearchInitializedRef = useRef(false);
  useEffect(() => {
    if (isServerMode) return;
    if (!clientSearchInitializedRef.current) {
      clientSearchInitializedRef.current = true;
      return;
    }
    table.setPageIndex(0);
    onPageChange?.(1);
  }, [currentSearch, isServerMode, onPageChange, table]);

  const selectedRows = Object.entries(currentRowSelection)
    .filter(([, selected]) => selected)
    .map(([id]) => currentRowsById.get(id) ?? selectedRowsSnapshotRef.current.get(id))
    .filter((row): row is TData => row !== undefined);
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const activeFilters =
    Object.values(currentFilterValues).filter((value) => value.length > 0).length +
    (searchTokenVariants.length > 0 ? 1 : 0) +
    activeToolbarFilters;
  const currentPageIndex = isServerMode
    ? Math.max(currentPage - 1, 0)
    : table.getState().pagination.pageIndex;
  const currentPageSize = isServerMode ? serverPageSize : table.getState().pagination.pageSize;
  const currentPageCount = isServerMode ? Math.max(totalPages ?? 1, 1) : table.getPageCount();
  const currentExpandedRowId = expandedRowId ?? localExpandedRowId;
  const pages = pageNumbers(currentPageIndex, currentPageCount);
  const resolvedRowHeight =
    rowHeight ?? (currentDensity === "compact" ? 40 : currentDensity === "comfortable" ? 60 : 48);

  function handleDensityChange(value: AppDataTableDensity) {
    if (density !== undefined) onDensityChange?.(value);
    else {
      setLocalDensity(value);
      onDensityChange?.(value);
    }
  }
  const remoteViewStateKey = JSON.stringify([currentSearch, currentSorting, currentFilterValues]);

  const requestMoreIfNeeded = useCallback(
    (scrollElement: HTMLDivElement) => {
      if (
        !isInfiniteMode ||
        !hasMore ||
        loadingMore ||
        loadMoreError ||
        !onLoadMore ||
        loadMoreRequestedRef.current
      ) {
        return;
      }

      const distanceFromBottom =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      if (distanceFromBottom > loadMoreThreshold) return;

      loadMoreRequestedRef.current = true;
      onLoadMore();
    },
    [hasMore, isInfiniteMode, loadMoreError, loadMoreThreshold, loadingMore, onLoadMore],
  );

  useEffect(() => {
    if (!loadingMore) loadMoreRequestedRef.current = false;
  }, [data.length, loadingMore]);

  useEffect(() => {
    const scrollElement = scrollContainerRef.current;
    if (!scrollElement || !isInfiniteMode) return;

    const frame = window.requestAnimationFrame(() => requestMoreIfNeeded(scrollElement));
    return () => window.cancelAnimationFrame(frame);
  }, [data.length, isInfiniteMode, requestMoreIfNeeded]);

  useEffect(() => {
    if (!isInfiniteMode) return;
    setScrollTop(0);
    loadMoreRequestedRef.current = false;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [isInfiniteMode, remoteViewStateKey]);

  useEffect(() => {
    if (!virtualized || !isUnpaginatedClientMode) return;
    setScrollTop(0);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [isUnpaginatedClientMode, remoteViewStateKey, virtualized]);

  function handleSearchChange(value: string) {
    if (usesExternalSearch) {
      setRemoteSearchInput(value);
      if (!value) {
        onSearchChange?.("");
        onPageChange?.(1);
      }
      return;
    }
    setLocalSearchInput(value);
    if (!value) {
      setLocalSearch("");
      onSearchChange?.("");
    }
  }

  function handleFilterChange(columnId: string, values: string[]) {
    if (usesExternalFilters) {
      const next = { ...currentFilterValues };
      if (values.length > 0) next[columnId] = values;
      else delete next[columnId];

      onFilterValuesChange?.(next);
      if (isServerMode) onPageChange?.(1);
      else {
        table.setPageIndex(0);
        onPageChange?.(1);
      }
      return;
    }

    const next = { ...localFilterValues };
    if (values.length > 0) next[columnId] = values;
    else delete next[columnId];
    setLocalFilterValues(next);
    onFilterValuesChange?.(next);
    table.setPageIndex(0);
    onPageChange?.(1);
  }

  function clearFilters() {
    onClearToolbarFilters?.();
    if (usesExternalSearch || usesExternalFilters) {
      setRemoteSearchInput("");
      onSearchChange?.("");
      onFilterValuesChange?.({});
      if (isServerMode) onPageChange?.(1);
      else {
        table.setPageIndex(0);
        onPageChange?.(1);
      }
      return;
    }
    setLocalSearchInput("");
    setLocalSearch("");
    setLocalFilterValues({});
    onSearchChange?.("");
    onFilterValuesChange?.({});
    table.setPageIndex(0);
    onPageChange?.(1);
  }

  function handleDataRowClick(row: Row<TData>, event: { target: EventTarget | null }) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "a, button, input, select, textarea, summary, [role='button'], [role='checkbox'], [role='menuitem'], [role='option']",
      )
    ) {
      return;
    }

    onRowClick?.(row.original);
    if (!renderExpandedRow) return;

    const nextRowId = currentExpandedRowId === row.id ? null : row.id;
    if (expandedRowId === undefined) setLocalExpandedRowId(nextRowId);
    onExpandedRowIdChange?.(nextRowId, nextRowId ? row.original : null);
  }

  function handleDataRowDoubleClick(row: Row<TData>, event: { target: EventTarget | null }) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "a, button, input, select, textarea, summary, [role='button'], [role='checkbox'], [role='menuitem'], [role='option']",
      )
    ) {
      return;
    }
    onRowDoubleClick?.(row.original);
  }

  function handleDataRowContextMenu(row: Row<TData>, event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "a, button, input, select, textarea, summary, [role='button'], [role='checkbox'], [role='menuitem'], [role='option']",
      )
    ) {
      return;
    }
    const actions = contextMenuActions?.(row.original) ?? [];
    if (actions.length > 0) {
      event.preventDefault();
      setContextMenu({ row: row.original, x: event.clientX, y: event.clientY });
      return;
    }
    onRowContextMenu?.(row.original, event);
  }

  function handleDataRowKeyDown(row: Row<TData>, event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget) return;
    if (!onRowClick && !onRowDoubleClick && !renderExpandedRow) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!onRowClick && !renderExpandedRow) {
      handleDataRowDoubleClick(row, event);
      return;
    }
    handleDataRowClick(row, event);
  }

  const rows = table.getRowModel().rows;
  const footerTotal = isServerMode ? (totalItems ?? 0) : clientFilteredData.length;
  const maximumScrollTop = Math.max(rows.length * resolvedRowHeight - virtualScrollHeight, 0);
  const effectiveScrollTop = Math.min(scrollTop, maximumScrollTop);
  const visibleRowCount = Math.ceil(virtualScrollHeight / resolvedRowHeight);
  const virtualStart = virtualized
    ? Math.max(Math.floor(effectiveScrollTop / resolvedRowHeight) - overscan, 0)
    : 0;
  const virtualEnd = virtualized
    ? Math.min(virtualStart + visibleRowCount + overscan * 2, rows.length)
    : rows.length;
  const renderedRows = virtualized ? rows.slice(virtualStart, virtualEnd) : rows;
  const supportsGroupHeaders = Boolean(groupBy && renderGroupHeader && !virtualized);
  const groupedRows = new Map<string, TData[]>();
  if (supportsGroupHeaders && groupBy) {
    renderedRows.forEach((row) => {
      const groupId = groupBy(row.original);
      if (!groupId) return;
      groupedRows.set(groupId, [...(groupedRows.get(groupId) ?? []), row.original]);
    });
  }
  const topSpacerHeight = virtualStart * resolvedRowHeight;
  const bottomSpacerHeight = Math.max((rows.length - virtualEnd) * resolvedRowHeight, 0);

  useEffect(() => {
    if (scrollPositionRestoredRef.current || loading || error || data.length === 0) return;
    const element = scrollContainerRef.current;
    if (!element || !initialScrollPosition) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = Math.max(0, initialScrollPosition.top);
      element.scrollLeft = Math.max(0, initialScrollPosition.left);
      setScrollTop(element.scrollTop);
      scrollPositionRestoredRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data.length, error, initialScrollPosition, loading]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    onScrollPositionChange?.({
      top: event.currentTarget.scrollTop,
      left: event.currentTarget.scrollLeft,
    });
    if (virtualized) setScrollTop(event.currentTarget.scrollTop);
    requestMoreIfNeeded(event.currentTarget);
  }

  const virtualScrollStyle = virtualized
    ? ({
        height: virtualScrollHeight,
        "--app-data-table-virtual-row-height": `${resolvedRowHeight}px`,
      } as CSSProperties)
    : undefined;

  const filterConditionCount =
    Object.values(currentFilterValues).filter((values) => values.length > 0).length +
    activeToolbarFilters;
  const renderFilterControls = (showLabels = false) => (
    <>
      {toolbarFilters}
      {columns
        .filter((column) => column.filterable && column.filterOptions)
        .map((column) => (
          <div className="app-data-table__filter" key={column.id}>
            <AppSelect
              ariaLabel={column.header}
              label={showLabels ? column.header : undefined}
              options={column.filterOptions ?? []}
              value={currentFilterValues[column.id] ?? []}
              multiple
              searchable
              showSelectedTags={false}
              multipleValueDisplay="count"
              placeholder={column.header}
              onValueChange={(value) => handleFilterChange(column.id, value as string[])}
            />
          </div>
        ))}
    </>
  );
  const tableTools = (
    <div className="app-data-table__tools">
      <DropdownMenu>
        <AppTooltip content="Настроить колонки">
          <DropdownMenuTrigger asChild>
            <AppButton
              type="button"
              variant="secondary"
              className="app-data-table__tool-button"
              aria-label="Настроить колонки"
            >
              <Columns3 size={18} />
              <span className="app-data-table__tool-label">Колонки</span>
            </AppButton>
          </DropdownMenuTrigger>
        </AppTooltip>
        <DropdownMenuContent align="end">
          {table
            .getAllLeafColumns()
            .filter((column) => column.getCanHide())
            .map((column) => (
              <DropdownMenuItem
                key={column.id}
                onSelect={(event) => {
                  event.preventDefault();
                  column.toggleVisibility();
                }}
              >
                <Checkbox checked={column.getIsVisible()} aria-hidden="true" tabIndex={-1} />
                {(column.columnDef.meta as { label?: string })?.label ?? column.id}
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
              className="app-data-table__tool-button"
              aria-label="Плотность строк"
            >
              <Rows3 size={18} />
              <span className="app-data-table__tool-label">Плотность</span>
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
            <DropdownMenuItem key={value} onSelect={() => handleDensityChange(value)}>
              <span
                className={`app-data-table__density-dot ${currentDensity === value ? "active" : ""}`}
              />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div
      className={`app-data-table density-${currentDensity}${virtualized ? " is-virtualized" : ""}${
        isInfiniteMode ? " is-infinite" : ""
      }${mobileFilterDialog ? " has-mobile-filter-dialog" : ""}${renderMobileRow && !virtualized ? " has-mobile-cards" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="app-data-table__toolbar">
        <div className="app-data-table__toolbar-main">
          <div className="app-data-table__filters-row">
            {searchable && (
              <label className="app-data-table__search">
                <Search size={17} />
                <input
                  value={visibleSearch}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  onChange={(event) => handleSearchChange(event.target.value)}
                />
                {visibleSearch && (
                  <button
                    type="button"
                    aria-label="Очистить поиск"
                    onClick={() => handleSearchChange("")}
                  >
                    <X size={15} />
                  </button>
                )}
              </label>
            )}

            <div className="app-data-table__inline-filters">{renderFilterControls()}</div>
          </div>

          {activeFilters > 0 && (
            <AppButton variant="ghost" className="app-data-table__clear" onClick={clearFilters}>
              <X size={16} />
              Сбросить ({activeFilters})
            </AppButton>
          )}
        </div>

        {tableTools}
        {mobileFilterDialog && (
          <AppButton
            type="button"
            variant="secondary"
            className="app-data-table__mobile-filter-button"
            onClick={() => setMobileFiltersOpen(true)}
          >
            <ListFilter size={17} />
            Фильтры{filterConditionCount > 0 ? ` (${filterConditionCount})` : ""}
          </AppButton>
        )}
      </div>

      {mobileFilterDialog && (
        <>
          {filterConditionCount > 0 && (
            <div className="app-data-table__mobile-filter-tags" aria-label="Активные фильтры">
              {mobileToolbarFilterTags}
              {columns.flatMap((column) =>
                (currentFilterValues[column.id] ?? []).map((value) => (
                  <button
                    type="button"
                    key={`${column.id}-${value}`}
                    aria-label={`Убрать фильтр: ${column.header}, ${column.filterOptions?.find((option) => option.value === value)?.label ?? value}`}
                    onClick={() =>
                      handleFilterChange(
                        column.id,
                        (currentFilterValues[column.id] ?? []).filter((item) => item !== value),
                      )
                    }
                  >
                    {column.filterOptions?.find((option) => option.value === value)?.label ?? value}
                    <X size={13} aria-hidden="true" />
                  </button>
                )),
              )}
            </div>
          )}
          <AppModal
            title="Фильтры и вид списка"
            description="Условия применяются сразу."
            open={mobileFiltersOpen}
            onOpenChange={setMobileFiltersOpen}
            contentClassName="app-data-table__filter-modal"
          >
            <div className="app-data-table__filter-modal-body">
              {renderFilterControls(true)}
              <div className="app-data-table__filter-modal-settings">
                <span>Вид таблицы</span>
                {tableTools}
              </div>
              <div className="app-data-table__filter-modal-actions">
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={clearFilters}
                  disabled={activeFilters === 0}
                >
                  Сбросить
                </AppButton>
                <AppButton type="button" onClick={() => setMobileFiltersOpen(false)}>
                  Показать список
                </AppButton>
              </div>
            </div>
          </AppModal>
        </>
      )}

      {showSelectionSummary && selectedRows.length > 0 && (
        <div className="app-data-table__bulk">
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
            <button
              type="button"
              onClick={() => {
                selectedRowsSnapshotRef.current.clear();
                setLocalRowSelection({});
              }}
            >
              Отменить выбор
            </button>
          </div>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="app-data-table__scroll"
        style={virtualScrollStyle}
        tabIndex={0}
        role="region"
        aria-label="Таблица данных с прокруткой"
        onScroll={handleScroll}
      >
        <table
          className="app-data-table__table"
          aria-busy={loading || loadingMore}
          aria-rowcount={
            virtualized
              ? (isInfiniteMode && totalItems !== undefined ? totalItems : rows.length) + 1
              : undefined
          }
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    | { align?: string; width?: number }
                    | undefined;
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={`align-${meta?.align ?? "left"}`}
                      style={meta?.width ? { width: meta.width } : undefined}
                      aria-sort={
                        header.column.getCanSort()
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: Math.min(currentPageSize, 6) }).map((_, rowIndex) => (
                <tr key={`loading-${rowIndex}`}>
                  {Array.from({ length: visibleColumnCount }).map((__, cellIndex) => (
                    <td key={cellIndex}>
                      <span className="app-data-table__skeleton" />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && error && (
              <tr>
                <td colSpan={visibleColumnCount}>
                  <div className="app-data-table__state error">
                    <ListFilter size={28} />
                    <strong>Не удалось загрузить данные</strong>
                    <span>{error}</span>
                  </div>
                </td>
              </tr>
            )}

            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumnCount}>
                  <div className="app-data-table__state">
                    <ListFilter size={28} />
                    <strong>{emptyTitle}</strong>
                    <span>{emptyDescription}</span>
                  </div>
                </td>
              </tr>
            )}

            {!loading && !error && virtualized && topSpacerHeight > 0 && (
              <tr className="app-data-table__virtual-spacer" aria-hidden="true">
                <td colSpan={visibleColumnCount} style={{ height: topSpacerHeight }} />
              </tr>
            )}

            {!loading &&
              !error &&
              renderedRows.map((row, renderedIndex) => {
                const groupId = supportsGroupHeaders && groupBy ? groupBy(row.original) : null;
                const previousGroupId =
                  supportsGroupHeaders && groupBy && renderedIndex > 0
                    ? groupBy(renderedRows[renderedIndex - 1].original)
                    : null;
                const group = groupId
                  ? {
                      id: groupId,
                      rows: groupedRows.get(groupId) ?? [row.original],
                      collapsed: collapsedGroupIds?.has(groupId) ?? false,
                    }
                  : null;
                const isFirstGroupRow = Boolean(group && group.id !== previousGroupId);
                const isExpanded = currentExpandedRowId === row.id;
                const rowIsInteractive = Boolean(
                  onRowClick || onRowDoubleClick || renderExpandedRow,
                );
                const { className: extraRowClassName, ...extraRowProps } =
                  rowProps?.(row.original) ?? {};

                return (
                  <Fragment key={row.id}>
                    {isFirstGroupRow && group && renderGroupHeader && (
                      <tr className={groupRowClassName?.(group)}>
                        <td colSpan={visibleColumnCount}>{renderGroupHeader(group)}</td>
                      </tr>
                    )}
                    {!group?.collapsed && (
                      <>
                        <tr
                          {...extraRowProps}
                          className={`${renderMobileRow && !virtualized ? "app-data-table__row--mobile-card " : ""}${rowClassName?.(row.original) ?? ""}${extraRowClassName ? ` ${extraRowClassName}` : ""}${rowIsInteractive ? " app-data-table__row--interactive" : ""}`}
                          data-row-id={row.id}
                          data-selected={row.getIsSelected() || undefined}
                          data-expanded={isExpanded || undefined}
                          data-virtual-row={virtualized ? virtualStart + renderedIndex : undefined}
                          aria-rowindex={virtualized ? virtualStart + renderedIndex + 2 : undefined}
                          aria-expanded={renderExpandedRow ? isExpanded : undefined}
                          tabIndex={rowIsInteractive ? 0 : undefined}
                          style={virtualized ? { height: resolvedRowHeight } : undefined}
                          onClick={(event) => handleDataRowClick(row, event)}
                          onDoubleClick={(event) => handleDataRowDoubleClick(row, event)}
                          onContextMenu={(event) => handleDataRowContextMenu(row, event)}
                          onKeyDown={(event) => handleDataRowKeyDown(row, event)}
                        >
                          {renderMobileRow && !virtualized && (
                            <td
                              colSpan={visibleColumnCount}
                              className="app-data-table__mobile-card-cell"
                            >
                              {renderMobileRow(row.original)}
                            </td>
                          )}
                          {row.getVisibleCells().map((cell) => {
                            const meta = cell.column.columnDef.meta as
                              | { align?: string; label?: string }
                              | undefined;
                            // These are render callbacks, not component types. Mounting them
                            // through flexRender remounts inputs whenever columns change.
                            const renderCell = cell.column.columnDef.cell;
                            return (
                              <td
                                key={cell.id}
                                className={`app-data-table__desktop-cell align-${meta?.align ?? "left"}`}
                                data-column-id={cell.column.id}
                                data-label={meta?.label}
                              >
                                {typeof renderCell === "function"
                                  ? renderCell(cell.getContext())
                                  : renderCell}
                              </td>
                            );
                          })}
                        </tr>
                        {isExpanded && renderExpandedRow && (
                          <tr className="app-data-table__expanded-row">
                            <td colSpan={visibleColumnCount}>{renderExpandedRow(row.original)}</td>
                          </tr>
                        )}
                      </>
                    )}
                  </Fragment>
                );
              })}

            {!loading && !error && virtualized && bottomSpacerHeight > 0 && (
              <tr className="app-data-table__virtual-spacer" aria-hidden="true">
                <td colSpan={visibleColumnCount} style={{ height: bottomSpacerHeight }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="app-data-table__footer">
        {isInfiniteMode ? (
          <>
            <span>
              Загружено {data.length}
              {totalItems !== undefined ? ` из ${totalItems}` : ""}
            </span>
            <span className="app-data-table__load-status" role="status" aria-live="polite">
              {loadMoreError ? (
                <span className="app-data-table__load-error" role="alert">
                  {loadMoreError}
                  {onRetryLoadMore && (
                    <button
                      type="button"
                      onClick={() => {
                        loadMoreRequestedRef.current = false;
                        onRetryLoadMore();
                      }}
                    >
                      Повторить
                    </button>
                  )}
                </span>
              ) : loadingMore ? (
                "Загружаем следующие записи…"
              ) : hasMore ? (
                "Прокрутите ниже, чтобы загрузить ещё"
              ) : (
                "Все записи загружены"
              )}
            </span>
          </>
        ) : isUnpaginatedClientMode ? (
          <span>{footerTotal ? `${footerTotal} записей` : "0 записей"}</span>
        ) : (
          <>
            <span>
              {footerTotal
                ? `${currentPageIndex * currentPageSize + 1}–${Math.min(
                    (currentPageIndex + 1) * currentPageSize,
                    footerTotal,
                  )} из ${footerTotal}`
                : "0 записей"}
            </span>

            <div className="app-data-table__page-size">
              <span>Строк:</span>
              <AppSelect
                options={pageSizes.map((size) => ({ value: String(size), label: String(size) }))}
                value={String(currentPageSize)}
                onValueChange={(value) => {
                  if (isServerMode) {
                    onPageSizeChange?.(Number(value));
                    onPageChange?.(1);
                  } else {
                    const nextSize = Number(value);
                    table.setPageSize(nextSize);
                    table.setPageIndex(0);
                    onPageSizeChange?.(nextSize);
                    onPageChange?.(1);
                  }
                }}
              />
            </div>

            <div className="app-data-table__pagination">
              <button
                type="button"
                disabled={currentPageIndex <= 0}
                onClick={() => {
                  if (isServerMode) onPageChange?.(1);
                  else {
                    table.setPageIndex(0);
                    onPageChange?.(1);
                  }
                }}
                aria-label="Первая страница"
              >
                <ChevronsLeft size={17} />
              </button>
              <button
                type="button"
                disabled={currentPageIndex <= 0}
                onClick={() => {
                  if (isServerMode) onPageChange?.(currentPageIndex);
                  else {
                    table.previousPage();
                    onPageChange?.(currentPageIndex);
                  }
                }}
                aria-label="Предыдущая страница"
              >
                <ChevronLeft size={17} />
              </button>
              {pages.map((pageNumber, index) => (
                <span key={pageNumber} className="app-data-table__page-item">
                  {index > 0 && pageNumber - pages[index - 1] > 1 && <i>…</i>}
                  <button
                    type="button"
                    className={pageNumber === currentPageIndex ? "active" : ""}
                    onClick={() => {
                      if (isServerMode) onPageChange?.(pageNumber + 1);
                      else {
                        table.setPageIndex(pageNumber);
                        onPageChange?.(pageNumber + 1);
                      }
                    }}
                  >
                    {pageNumber + 1}
                  </button>
                </span>
              ))}
              <button
                type="button"
                disabled={currentPageIndex >= currentPageCount - 1}
                onClick={() => {
                  if (isServerMode) onPageChange?.(currentPageIndex + 2);
                  else {
                    table.nextPage();
                    onPageChange?.(currentPageIndex + 2);
                  }
                }}
                aria-label="Следующая страница"
              >
                <ChevronRight size={17} />
              </button>
              <button
                type="button"
                disabled={currentPageIndex >= currentPageCount - 1}
                onClick={() => {
                  if (isServerMode) onPageChange?.(currentPageCount);
                  else {
                    const lastPage = Math.max(0, table.getPageCount() - 1);
                    table.setPageIndex(lastPage);
                    onPageChange?.(lastPage + 1);
                  }
                }}
                aria-label="Последняя страница"
              >
                <ChevronsRight size={17} />
              </button>
            </div>
          </>
        )}
      </div>
      {contextMenu && (
        <AppContextMenu
          open
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextMenuActions?.(contextMenu.row) ?? []}
          label={contextMenuLabel?.(contextMenu.row) ?? "Действия со строкой"}
          onOpenChange={(open) => !open && setContextMenu(null)}
        />
      )}
    </div>
  );
}
