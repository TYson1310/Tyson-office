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
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data.split(",")[1] || base64Data,
            },
          },
          {
            text: INVOICE_EXTRACTION_PROMPT,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            invoiceNumber: { type: Type.STRING },
            issueDate: { type: Type.STRING },
            dueDate: { type: Type.STRING },
            vendorName: { type: Type.STRING },
            vendorAddress: { type: Type.STRING },
            customerName: { type: Type.STRING },
            subtotal: { type: Type.NUMBER },
            tax: { type: Type.NUMBER },
            total: { type: Type.NUMBER },
            currency: { type: Type.STRING },
            description: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unitPrice: { type: Type.NUMBER },
                  amount: { type: Type.NUMBER },
                },
                required: ["description", "amount"],
              },
            },
          },
          required: ["invoiceNumber", "issueDate", "total", "vendorName"],
        },
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
      error instanceof Error
        ? error.message
        : "Failed to process invoice",
    );
  }
}
