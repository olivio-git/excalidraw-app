import { useState, useEffect } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  PaginationState,
  RowSelectionState,
  SortingState,
  Table,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { PanelSearch } from "@/shared/common/PanelSearch";

// ── Re-exports ────────────────────────────────────────────────────────────────
// Consumers import from here — no direct @tanstack/react-table coupling needed.
export { createColumnHelper } from "@tanstack/react-table";
export type { ColumnDef } from "@tanstack/react-table";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaginationOptions {
  pageSize?: number;
}

interface RowSelectionOptions<TData> {
  onSelectionChange: (selectedRows: TData[]) => void;
}

export interface DataTableProps<TData> {
  // Core (required)
  columns: ColumnDef<TData, unknown>[];
  data: TData[];

  // Features — all opt-in, disabled by default
  sorting?: boolean;
  globalFilter?: boolean;
  pagination?: boolean | PaginationOptions;
  rowSelection?: RowSelectionOptions<TData>;

  // Row interaction
  onRowClick?: (row: TData) => void;
  getRowId?: (row: TData, index: number) => string;
  getRowClassName?: (row: TData) => string | undefined;

  // States
  loading?: boolean;
  loadingRowCount?: number;
  empty?: React.ReactNode;

  // Layout
  toolbar?: React.ReactNode;
  maxHeight?: string;
  className?: string;
}

// ── Internal: Toolbar ─────────────────────────────────────────────────────────

interface ToolbarProps {
  globalFilter: boolean;
  filterValue: string;
  onFilterChange: (v: string) => void;
  toolbar?: React.ReactNode;
}

function DataTableToolbar({ globalFilter, filterValue, onFilterChange, toolbar }: ToolbarProps) {
  if (!globalFilter && !toolbar) return null;
  return (
    <div className="flex items-center gap-3 mb-3">
      {globalFilter && (
        <PanelSearch value={filterValue} onChange={onFilterChange} className="flex-1 max-w-xs" />
      )}
      {toolbar && <div className="flex items-center gap-2 ml-auto">{toolbar}</div>}
    </div>
  );
}

// ── Internal: Pagination ──────────────────────────────────────────────────────

function DataTablePagination<TData>({ table }: { table: Table<TData> }) {
  const { pageIndex } = table.getState().pagination;
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <span className="text-xs text-muted-foreground">
        Page {pageIndex + 1} of {table.getPageCount()}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => table.previousPage()}
        disabled={!table.getCanPreviousPage()}
      >
        Prev
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => table.nextPage()}
        disabled={!table.getCanNextPage()}
      >
        Next
      </Button>
    </div>
  );
}

// ── Internal: Skeleton rows ───────────────────────────────────────────────────

const SKELETON_WIDTHS = ["w-2/5", "w-3/5", "w-1/2", "w-4/5", "w-1/3"] as const;

interface SkeletonRowsProps {
  columnCount: number;
  rowCount: number;
}

function SkeletonRows({ columnCount, rowCount }: SkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIdx) => (
        <tr key={rowIdx} className="border-b border-border">
          {Array.from({ length: columnCount }, (_, colIdx) => (
            <td key={colIdx} className="px-4 py-2.5">
              <Skeleton
                className={cn("h-4", SKELETON_WIDTHS[(rowIdx + colIdx) % SKELETON_WIDTHS.length])}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Internal: Sort icon ───────────────────────────────────────────────────────

function SortIcon({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ChevronUp className="size-3.5 ml-1 inline-block" />;
  if (sorted === "desc") return <ChevronDown className="size-3.5 ml-1 inline-block" />;
  return <ChevronsUpDown className="size-3 ml-1 inline-block opacity-40" />;
}

// ── DataTable ─────────────────────────────────────────────────────────────────

export function DataTable<TData>({
  columns: columnsProp,
  data,
  sorting: enableSorting = false,
  globalFilter: enableGlobalFilter = false,
  pagination: paginationProp = false,
  rowSelection: rowSelectionProp,
  onRowClick,
  getRowId,
  getRowClassName,
  loading = false,
  loadingRowCount = 5,
  empty,
  toolbar,
  maxHeight,
  className,
}: DataTableProps<TData>) {
  const [sortingState, setSortingState] = useState<SortingState>([]);
  const [filterValue, setFilterValue] = useState("");
  // pageSize is read once at mount from `paginationProp`. Changing `pagination.pageSize`
  // after mount has no effect — this component treats pagination config as static.
  const [paginationState, setPaginationState] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: typeof paginationProp === "object" ? (paginationProp.pageSize ?? 10) : 10,
  });
  const [rowSelectionState, setRowSelectionState] = useState<RowSelectionState>({});

  // Prepend selection checkbox column when rowSelection is enabled
  const selectionColumn: ColumnDef<TData, unknown> = {
    id: "__selection__",
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllPageRowsSelected()}
        ref={(el) => {
          if (el) el.indeterminate = table.getIsSomePageRowsSelected();
        }}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        className="size-3.5 cursor-pointer accent-primary"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        onClick={(e) => e.stopPropagation()}
        className="size-3.5 cursor-pointer accent-primary"
      />
    ),
    enableSorting: false,
    size: 40,
  };

  const columns = rowSelectionProp ? [selectionColumn, ...columnsProp] : columnsProp;

  const table = useReactTable<TData>({
    data,
    columns,
    getRowId: getRowId ? (row, idx) => getRowId(row, idx) : undefined,
    state: {
      ...(enableSorting && { sorting: sortingState }),
      ...(enableGlobalFilter && { globalFilter: filterValue }),
      ...(paginationProp && { pagination: paginationState }),
      ...(rowSelectionProp && { rowSelection: rowSelectionState }),
    },
    onSortingChange: enableSorting ? setSortingState : undefined,
    onGlobalFilterChange: enableGlobalFilter ? setFilterValue : undefined,
    onPaginationChange: paginationProp ? setPaginationState : undefined,
    onRowSelectionChange: rowSelectionProp ? setRowSelectionState : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: enableGlobalFilter ? getFilteredRowModel() : undefined,
    getPaginationRowModel: paginationProp ? getPaginationRowModel() : undefined,
  });

  // Notify parent when row selection changes.
  // Intentionally depends only on `rowSelectionState` (the ID map) — `table` and
  // `rowSelectionProp` are stable within a render cycle and don't need to re-trigger
  // the effect. Adding them would cause spurious calls on every re-render.
  useEffect(() => {
    if (!rowSelectionProp) return;
    const selected = table.getSelectedRowModel().rows.map((r) => r.original);
    rowSelectionProp.onSelectionChange(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelectionState]);

  const rows = table.getRowModel().rows;
  const columnCount = table.getAllColumns().length;

  return (
    <div className={cn("flex flex-col", className)}>
      <DataTableToolbar
        globalFilter={enableGlobalFilter}
        filterValue={filterValue}
        onFilterChange={setFilterValue}
        toolbar={toolbar}
      />

      <div className="rounded-md border border-border overflow-hidden">
        <div className="overflow-y-auto" style={maxHeight ? { maxHeight } : undefined}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-border bg-muted/60">
                  {headerGroup.headers.map((header) => {
                    const canSort = enableSorting && header.column.getCanSort();
                    return (
                      <th
                        key={header.id}
                        style={{ width: header.column.columnDef.size }}
                        className={cn(
                          "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none",
                          canSort && "cursor-pointer hover:text-foreground transition-colors"
                        )}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      >
                        {header.isPlaceholder ? null : (
                          <>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {canSort && <SortIcon sorted={header.column.getIsSorted()} />}
                          </>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <SkeletonRows columnCount={columnCount} rowCount={loadingRowCount} />
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    {empty ?? "No results."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "bg-background transition-colors hover:bg-muted/40",
                      onRowClick && "cursor-pointer",
                      getRowClassName?.(row.original)
                    )}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {paginationProp && <DataTablePagination table={table} />}
    </div>
  );
}
