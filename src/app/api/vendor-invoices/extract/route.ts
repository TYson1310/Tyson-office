import { NextRequest, NextResponse } from "next/server";
import {
  detectInvoiceMimeType,
  isAllowedInvoiceFile,
  MAX_INVOICE_UPLOAD_BYTES,
} from "@/lib/vendors/invoice-processing";
import { requireVendorManagerAccess } from "@/lib/vendors/api";
import {
  InvoiceExtractionError,
  processInvoice,
} from "@/services/geminiService";
import type { InvoiceExtractionResponse } from "@/types/types";

export const runtime = "nodejs";

function validateInvoiceFile(file: File) {
  if (file.size <= 0) {
    return "Invoice file is empty";
  }

  if (file.size > MAX_INVOICE_UPLOAD_BYTES) {
    return "Invoice file must be 10MB or smaller";
  }

  if (!isAllowedInvoiceFile(file.name, file.type)) {
    return "Upload a PDF, PNG, JPG, or WEBP invoice";
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Gemini API key required" },
        { status: 503 },
      );
    }

    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Invoice file is required" },
        { status: 400 },
      );
    }

    const fileError = validateInvoiceFile(file);

    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    const fileBytes = Buffer.from(await file.arrayBuffer());
    const mimeType = detectInvoiceMimeType(fileBytes, file.type, file.name);

    if (!mimeType) {
      return NextResponse.json(
        { error: "Upload a valid PDF, PNG, JPG, or WEBP invoice" },
        { status: 400 },
      );
    }

    const invoice = await processInvoice(
      fileBytes.toString("base64"),
      mimeType,
    );
    const responseBody: InvoiceExtractionResponse = { invoice };

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("Vendor invoice extraction error:", error);

    if (error instanceof InvoiceExtractionError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to process invoice",
      },
      { status: 500 },
    );
  }
}
