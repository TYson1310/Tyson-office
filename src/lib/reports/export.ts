export type ReportExportKey =
  | "dashboard"
  | "lottery"
  | "sales"
  | "profit"
  | "margin-analysis"
  | "vendor-analysis"
  | "vendor-ledger"
  | "payroll-analysis"
  | "employee-payroll";

type CsvValue = string | number | boolean | Date | null | undefined;
type ReportQueryValue = string | number | boolean | null | undefined;

export function getReportExportHref(
  report: ReportExportKey,
  params?: Record<string, ReportQueryValue>,
) {
  const searchParams = new URLSearchParams({
    report,
  });

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return;
    }

    searchParams.set(key, String(value));
  });

  return `/api/reports/export?${searchParams.toString()}`;
}

function stringifyCsvValue(value: CsvValue) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function escapeCsvValue(value: CsvValue) {
  const stringValue = stringifyCsvValue(value);

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function buildCsv(rows: Array<Record<string, CsvValue>>) {
  const headers: string[] = [];

  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!headers.includes(key)) {
        headers.push(key);
      }
    });
  });

  if (headers.length === 0) {
    return "";
  }

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvValue(row[header])).join(","),
    ),
  ];

  return lines.join("\r\n");
}

export function buildReportFilename(report: ReportExportKey, dateKey: string) {
  return `${report}-${dateKey}.csv`;
}
