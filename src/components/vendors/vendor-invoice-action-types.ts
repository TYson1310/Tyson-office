export type VendorInvoiceActionRecord = {
  id: string;
  vendorName: string;
  supplierId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  total: number;
  currency: string;
  description: string;
  status: "pending" | "paid" | "overdue" | "cancelled";
  paidAmount: number;
  adjustmentAmount: number;
  notes: string;
  pdfFileName?: string;
  pdfMimeType?: string;
  pdfUrl?: string;
};
