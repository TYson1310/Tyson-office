export type NrsSalesRow = {
  upc: string | null;
  name: string;
  totalQty: number;
  totalAmount: number;
};

export type NrsInventoryRow = {
  upc: string;
  name: string;
  department: string;
  inStock: number;
  predictedDays: number | null;
  countThreshold: number;
  daysThreshold: number;
};

function normalizeText(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function parseNumber(value: string | undefined) {
  const normalized = normalizeText(value).replace(/[$,]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }

  return rows;
}

function headerIndex(headers: string[], expected: string) {
  const normalizedExpected = expected.toLowerCase().replace(/\s+/g, " ");
  return headers.findIndex(
    (header) =>
      normalizeText(header).toLowerCase().replace(/\s+/g, " ") ===
      normalizedExpected,
  );
}

export function parseNrsSalesHistoryCsv(text: string): NrsSalesRow[] {
  const rows = parseCsvRows(text);
  const headers = rows.shift() ?? [];
  const upcIndex = headerIndex(headers, "UPC");
  const nameIndex = headerIndex(headers, "Name");
  const quantityIndex = headerIndex(headers, "Total Qty");
  const amountIndex = headerIndex(headers, "Total Amount");

  if (nameIndex < 0 || quantityIndex < 0 || amountIndex < 0) {
    throw new Error(
      "NRS Sales History CSV must contain UPC, Name, Total Qty, and Total Amount columns",
    );
  }

  return rows
    .map((row) => ({
      upc: normalizeText(row[upcIndex]) || null,
      name: normalizeText(row[nameIndex]),
      totalQty: Math.max(Math.round(parseNumber(row[quantityIndex])), 0),
      totalAmount: Math.round(parseNumber(row[amountIndex]) * 100) / 100,
    }))
    .filter((row) => row.name && row.totalQty > 0 && row.totalAmount >= 0);
}

export function parseNrsCashTenderAmount(text: string): number | null {
  const rows = parseCsvRows(text);
  const aliases = new Set([
    "cash tender",
    "cash tenders",
    "cash sales",
    "cash amount",
    "total cash",
    "cash total",
  ]);

  for (const [rowIndex, row] of rows.entries()) {
    const columnIndex = row.findIndex((value) =>
      aliases.has(normalizeText(value).toLowerCase()),
    );

    if (columnIndex < 0) {
      continue;
    }

    const values = rows
      .slice(rowIndex + 1)
      .map((nextRow) => normalizeText(nextRow[columnIndex]))
      .filter(Boolean)
      .map((value) => parseNumber(value));

    if (values.length > 0) {
      return (
        Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100
      );
    }
  }

  return null;
}

export function parseNrsInventoryStatusCsv(text: string): NrsInventoryRow[] {
  const rows = parseCsvRows(text);
  const headerRowIndex = rows.findIndex((row) =>
    row.some((value) => normalizeText(value).toLowerCase() === "upc"),
  );

  if (headerRowIndex < 0) {
    throw new Error(
      "NRS Inventory Status CSV must contain a UPC header row",
    );
  }

  const headers = rows.splice(0, headerRowIndex + 1).at(-1) ?? [];
  const upcIndex = headerIndex(headers, "UPC");
  const nameIndex = headerIndex(headers, "Name");
  const departmentIndex = headerIndex(headers, "Department");
  const stockIndex = headerIndex(headers, "In Stock");
  const predictedDaysIndex = headerIndex(headers, "Predicted Days");
  const countThresholdIndex = headerIndex(headers, "Count Threshold");
  const daysThresholdIndex = headerIndex(headers, "Days Threshold");

  if (
    upcIndex < 0 ||
    nameIndex < 0 ||
    departmentIndex < 0 ||
    stockIndex < 0
  ) {
    throw new Error(
      "NRS Inventory Status CSV must contain UPC, Name, Department, and In Stock columns",
    );
  }

  return rows
    .map((row) => {
      const predictedDays = normalizeText(row[predictedDaysIndex]);

      return {
        upc: normalizeText(row[upcIndex]),
        name: normalizeText(row[nameIndex]),
        department: normalizeText(row[departmentIndex]) || "Uncategorized",
        inStock: Math.max(Math.round(parseNumber(row[stockIndex])), 0),
        predictedDays: predictedDays ? parseNumber(predictedDays) : null,
        countThreshold:
          countThresholdIndex >= 0
            ? Math.max(Math.round(parseNumber(row[countThresholdIndex])), 0)
            : 0,
        daysThreshold:
          daysThresholdIndex >= 0
            ? Math.max(Math.round(parseNumber(row[daysThresholdIndex])), 0)
            : 0,
      };
    })
    .filter((row) => row.upc && row.name);
}

export function extractNrsReportDate(fileName: string) {
  const match =
    /(?:^|_)([A-Za-z]{3})_(\d{1,2}),_(\d{4})(?:\.|$)/i.exec(fileName);

  if (!match) {
    throw new Error(`Unable to determine report date from ${fileName}`);
  }

  const month = new Date(`${match[1]} 1, ${match[3]}`).getMonth() + 1;
  const monthKey = String(month).padStart(2, "0");
  const dayKey = match[2].padStart(2, "0");

  return `${match[3]}-${monthKey}-${dayKey}`;
}

export function buildNrsImportLinePrefix(importId: string) {
  return `NRS import:${importId} |`;
}
