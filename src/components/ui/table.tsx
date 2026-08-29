"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import * as React from "react";

const DEFAULT_ROWS_PER_PAGE = 10;

type TablePaginationContextValue = {
  page: number;
  rowsPerPage: number;
  setTotalRows: React.Dispatch<React.SetStateAction<number>>;
};

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  rowsPerPage?: number;
  totalRows?: number;
};

const TablePaginationContext =
  React.createContext<TablePaginationContextValue | null>(null);

function flattenChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      return flattenChildren(
        (child.props as { children?: React.ReactNode }).children,
      );
    }

    return [child];
  });
}

function TablePagination({
  page,
  totalPages,
  totalRows,
  rowsPerPage,
  setPage,
}: {
  page: number;
  totalPages: number;
  totalRows: number;
  rowsPerPage: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  const startRow = totalRows === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const endRow = Math.min(page * rowsPerPage, totalRows);

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-slate-200/80 pt-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-medium text-slate-500">
        Showing {startRow}-{endRow} of {totalRows}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(current - 1, 1))}
          disabled={page === 1}
          className="app-icon-button disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:shadow-none"
          title="Previous page"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="min-w-[72px] text-center text-xs font-medium text-slate-600">
          {page} / {totalPages}
        </div>

        <button
          type="button"
          onClick={() =>
            setPage((current) => Math.min(current + 1, totalPages))
          }
          disabled={page === totalPages}
          className="app-icon-button disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:shadow-none"
          title="Next page"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Table({
  className,
  children,
  rowsPerPage = DEFAULT_ROWS_PER_PAGE,
  totalRows: explicitTotalRows,
  ...props
}: TableProps) {
  const [page, setPage] = React.useState(1);
  const [measuredTotalRows, setTotalRows] = React.useState(0);
  const totalRows = explicitTotalRows ?? measuredTotalRows;
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const shouldPaginate = totalRows > rowsPerPage;

  const paginationContext = React.useMemo(
    () => ({
      page,
      rowsPerPage,
      setTotalRows,
    }),
    [page, rowsPerPage],
  );

  React.useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <TablePaginationContext.Provider value={paginationContext}>
      <div className="min-w-0 w-full">
        <div className="relative w-full overflow-x-auto overscroll-x-contain">
          <table
            className={cn(
              "w-full min-w-max caption-bottom text-sm sm:min-w-full",
              className,
            )}
            {...props}
          >
            {children}
          </table>
        </div>

        {shouldPaginate ? (
          <TablePagination
            page={page}
            totalPages={totalPages}
            totalRows={totalRows}
            rowsPerPage={rowsPerPage}
            setPage={setPage}
          />
        ) : null}
      </div>
    </TablePaginationContext.Provider>
  );
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "bg-slate-50/70 [&_tr]:border-b [&_tr]:border-stroke/80",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  const pagination = React.useContext(TablePaginationContext);
  const rows = React.useMemo(() => flattenChildren(children), [children]);
  const setTotalRows = pagination?.setTotalRows;

  React.useLayoutEffect(() => {
    setTotalRows?.(rows.length);

    return () => {
      setTotalRows?.(0);
    };
  }, [setTotalRows, rows.length]);

  const visibleRows = React.useMemo(() => {
    if (!pagination || rows.length <= pagination.rowsPerPage) {
      return rows;
    }

    const start = (pagination.page - 1) * pagination.rowsPerPage;
    return rows.slice(start, start + pagination.rowsPerPage);
  }, [pagination, rows]);

  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props}>
      {visibleRows}
    </tbody>
  );
}

export function TableFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn(
        "border-t border-stroke/80 bg-slate-50/70 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-stroke/70 transition-colors hover:bg-teal-50/45 data-[state=selected]:bg-teal-50",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-11 px-3 text-left align-middle text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:h-12 sm:px-4 sm:text-[11px] [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        "p-3 align-top text-slate-700 sm:p-4 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}
