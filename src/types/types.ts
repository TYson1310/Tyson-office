/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface InvoiceItem {
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
  customerName?: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
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
Extract the following information from this entire document, scanning all pages if multiple pages are present, and return it as a JSON object.
Fields to extract:
- invoiceNumber (string)
- issueDate (string, ISO format preferred or as it appears on the invoice)
- dueDate (string, ISO format preferred when present)
- vendorName (string)
- vendorAddress (string, optional)
- customerName (string, optional)
- items (array of objects with description, quantity, unitPrice, amount)
- subtotal (number)
- tax (number)
- total (number)
- currency (string, e.g., USD, EUR)
- description (string, short summary of the invoice contents, optional)

Return only valid JSON.
`;
