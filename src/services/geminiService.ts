/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from "@google/genai";
import { sanitizeProcessedInvoice } from "@/lib/vendors/invoice-processing";
import { INVOICE_EXTRACTION_PROMPT, ProcessedInvoiceData } from "@/types/types";

const GEMINI_INVOICE_MODEL =
  process.env.GEMINI_INVOICE_MODEL?.trim() || "gemini-2.5-flash";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    timeout: 120_000,
    retryOptions: {
      attempts: 4,
    },
  },
});

const invoiceSchema = {
  type: Type.OBJECT,
  properties: {
    vendor: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, nullable: true },
        phone: { type: Type.STRING, nullable: true },
        email: { type: Type.STRING, nullable: true },
        address: { type: Type.STRING, nullable: true },
      },
      required: ["name", "phone", "email", "address"],
    },
    customer: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, nullable: true },
        customer_number: { type: Type.STRING, nullable: true },
        phone: { type: Type.STRING, nullable: true },
        address: { type: Type.STRING, nullable: true },
      },
      required: ["name", "customer_number", "phone", "address"],
    },
    invoice: {
      type: Type.OBJECT,
      properties: {
        invoice_number: { type: Type.STRING, nullable: true },
        invoice_date: { type: Type.STRING, nullable: true },
        due_date: { type: Type.STRING, nullable: true },
        currency: { type: Type.STRING, nullable: true },
        subtotal: { type: Type.NUMBER, nullable: true },
        tax_total: { type: Type.NUMBER, nullable: true },
        discount_total: { type: Type.NUMBER, nullable: true },
        final_total: { type: Type.NUMBER, nullable: true },
        ar_balance: { type: Type.NUMBER, nullable: true },
      },
      required: [
        "invoice_number",
        "invoice_date",
        "due_date",
        "currency",
        "subtotal",
        "tax_total",
        "discount_total",
        "final_total",
        "ar_balance",
      ],
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item_code: { type: Type.STRING, nullable: true },
          description: { type: Type.STRING, nullable: true },
          quantity: { type: Type.NUMBER, nullable: true },
          unit_price: { type: Type.NUMBER, nullable: true },
          line_total: { type: Type.NUMBER, nullable: true },
        },
        required: [
          "item_code",
          "description",
          "quantity",
          "unit_price",
          "line_total",
        ],
      },
    },
  },
  required: ["vendor", "customer", "invoice", "items"],
};

export class InvoiceExtractionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "InvoiceExtractionError";
    this.statusCode = statusCode;
  }
}

function isTransientGeminiTransportError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const cause = error.cause;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code ?? "")
      : "";

  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("timeout") ||
    causeCode === "UND_ERR_SOCKET" ||
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "ECONNRESET" ||
    causeCode === "ETIMEDOUT"
  );
}

export async function processInvoice(
  base64Data: string,
  mimeType: string,
): Promise<Partial<ProcessedInvoiceData>> {
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_INVOICE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: INVOICE_EXTRACTION_PROMPT,
            },
            {
              inlineData: {
                mimeType,
                data: base64Data.split(",")[1] || base64Data,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: invoiceSchema,
        temperature: 0,
      },
    });

    const text = response.text;
    if (!text) {
      throw new InvoiceExtractionError(
        "Invoice extraction returned an empty response. Try the upload again.",
      );
    }

    return sanitizeProcessedInvoice(JSON.parse(text));
  } catch (error) {
    console.error("Error processing invoice:", error);

    if (error instanceof InvoiceExtractionError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new InvoiceExtractionError(
        "Invoice extraction returned an invalid response. Try the upload again.",
      );
    }

    if (isTransientGeminiTransportError(error)) {
      throw new InvoiceExtractionError(
        "Invoice extraction is temporarily unavailable. Try again in a moment.",
        503,
      );
    }

    throw new InvoiceExtractionError(
      error instanceof Error ? error.message : "Failed to process invoice",
    );
  }
}
