"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect, useMemo } from "react";

interface Column<T> {
  key: keyof T;
  label: string;
  render?: (value: any, item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  title?: string;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
  onAdd?: () => void;
}

export function DataTable<T>({
  columns,
  data,
  title,
  onEdit,
  onDelete,
  onAdd,
}: DataTableProps<T>) {
  const [filteredData, setFilteredData] = useState(data);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;

  useEffect(() => {
    setFilteredData(
      data.filter((item) =>
        JSON.stringify(item).toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    );
  }, [data, searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, data]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const visibleRows = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredData.slice(start, start + rowsPerPage);
  }, [filteredData, page]);

  return (
    <div className="rounded-md border border-stroke bg-white dark:border-stroke-dark dark:bg-dark-2">
      <div className="px-4 py-6 md:px-6 xl:px-9">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex-1">
            {title && (
              <h4 className="mb-4 text-heading-6 font-bold text-dark dark:text-white">
                {title}
              </h4>
            )}
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-stroke-dark"
            />
          </div>
          {onAdd && (
            <button
              onClick={onAdd}
              className="ml-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-center font-medium text-white hover:bg-opacity-90"
            >
              + Add
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-auto">
            <thead>
              <tr className="bg-gray-2 text-left dark:bg-dark-3">
                {columns.map((col) => (
                  <th
                    key={String(col.key)}
                    className="px-4 py-4 font-medium text-dark dark:text-white"
                  >
                    {col.label}
                  </th>
                ))}
                {(onEdit || onDelete) && (
                  <th className="px-4 py-4 font-medium text-dark dark:text-white">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredData.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + (onEdit || onDelete ? 1 : 0)}
                    className="text-body-color px-4 py-6 text-center text-body-sm"
                  >
                    No data found
                  </td>
                </tr>
              ) : (
                visibleRows.map((item, index) => (
                  <tr
                    key={index}
                    className="border-b border-stroke dark:border-stroke-dark"
                  >
                    {columns.map((col) => (
                      <td
                        key={String(col.key)}
                        className="px-4 py-5 text-body-sm text-dark dark:text-white"
                      >
                        {col.render
                          ? col.render((item as any)[col.key], item)
                          : String((item as any)[col.key])}
                      </td>
                    ))}
                    {(onEdit || onDelete) && (
                      <td className="px-4 py-5">
                        <div className="flex space-x-2">
                          {onEdit && (
                            <button
                              onClick={() => onEdit(item)}
                              className="text-primary hover:underline"
                            >
                              Edit
                            </button>
                          )}
                          {onDelete && (
                            <button
                              onClick={() => onDelete(item)}
                              className="text-red hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredData.length > rowsPerPage ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-stroke pt-3 dark:border-stroke-dark sm:flex-row sm:items-center sm:justify-between">
            <div className="text-body-color dark:text-bodydark text-xs font-medium">
              Showing {(page - 1) * rowsPerPage + 1}-
              {Math.min(page * rowsPerPage, filteredData.length)} of{" "}
              {filteredData.length}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(current - 1, 1))}
                disabled={page === 1}
                className="app-icon-button disabled:cursor-not-allowed disabled:opacity-50"
                title="Previous page"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <div className="text-body-color dark:text-bodydark min-w-[72px] text-center text-xs font-medium">
                {page} / {totalPages}
              </div>

              <button
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(current + 1, totalPages))
                }
                disabled={page === totalPages}
                className="app-icon-button disabled:cursor-not-allowed disabled:opacity-50"
                title="Next page"
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
