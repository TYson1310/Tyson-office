/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface InvoiceItem {
  itemCode?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  itemsPerPack?: number;
  matchedProductId?: string;
}

export interface ProcessedInvoiceData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  vendorName: string;
  vendorAddress?: string;
  vendorPhone?: string;
  vendorEmail?: string;
  customerName?: string;
  customerNumber?: string;
  customerPhone?: string;
  customerAddress?: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  discountTotal?: number;
  total: number;
  arBalance?: number;
  currency: string;
  description?: string;
}

export interface InvoiceData extends ProcessedInvoiceData {
  id: string;
  status: "processing" | "completed" | "error";
  rawImage?: string;
}

export interface InvoiceVerificationPayload extends ProcessedInvoiceData {
  supplierId: string;
  notes?: string;
}

export interface InvoiceExtractionResponse {
  invoice: Partial<ProcessedInvoiceData>;
}

export const INVOICE_EXTRACTION_PROMPT = `
Extract invoice data from this invoice.

Rules:
- Return only JSON matching the schema.
- Do not guess missing values.
- If a value is missing, return null.
- Dates should be returned in YYYY-MM-DD format when possible.
- Amounts should be numbers only, without currency symbols.
- Extract all line items from the invoice table.
- Extract each line item's UPC, barcode, vendor item number, product code, or SKU into item_code when visible.
`;
