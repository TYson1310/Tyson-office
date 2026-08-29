"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Eye, X } from "lucide-react";
import type { VendorInvoiceActionRecord } from "@/components/vendors/vendor-invoice-action-types";
import { VendorModal } from "@/components/vendors/vendor-modal";

type ViewVendorInvoiceButtonProps = {
  invoice: VendorInvoiceActionRecord;
};

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      currencyDisplay: "code",
    }).format(amount);
  } catch {
    return `${currency || "USD"} ${amount.toFixed(2)}`;
  }
}

function getAttachmentKind(url?: string, kindHint?: string) {
  const normalizedHint = kindHint?.toLowerCase() ?? "";

  if (normalizedHint.includes("pdf") || normalizedHint.endsWith(".pdf")) {
    return "pdf" as const;
  }

  if (
    normalizedHint.startsWith("image/") ||
    normalizedHint.endsWith(".png") ||
    normalizedHint.endsWith(".jpg") ||
    normalizedHint.endsWith(".jpeg") ||
    normalizedHint.endsWith(".webp") ||
    normalizedHint.endsWith(".gif")
  ) {
    return "image" as const;
  }

  if (!url) {
    return "none" as const;
  }

  const normalizedUrl = url.split("?")[0]?.toLowerCase() ?? "";

  if (normalizedUrl.endsWith(".pdf")) {
    return "pdf" as const;
  }

  if (
    normalizedUrl.endsWith(".png") ||
    normalizedUrl.endsWith(".jpg") ||
    normalizedUrl.endsWith(".jpeg") ||
    normalizedUrl.endsWith(".webp") ||
    normalizedUrl.endsWith(".gif")
  ) {
    return "image" as const;
  }

  return "other" as const;
}

function buildLineItems(notes: string) {
  const itemsLine = notes
    .split("\n")
    .find((line) => line.trim().startsWith("Items:"));

  if (!itemsLine) {
    return [];
  }

  return itemsLine
    .replace(/^Items:\s*/i, "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildUserNotes(notes: string) {
  return notes
    .split("\n\n")
    .map((section) => section.trim())
    .filter(
      (section) =>
        section.length > 0 && !section.startsWith("AI extraction details"),
    );
}

export function ViewVendorInvoiceButton({
  invoice,
}: ViewVendorInvoiceButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const attachmentKind = getAttachmentKind(
    invoice.pdfUrl,
    invoice.pdfMimeType ?? invoice.pdfFileName,
  );
  const extractedLineItems = useMemo(
    () => buildLineItems(invoice.notes),
    [invoice.notes],
  );
  const noteSections = useMemo(
    () => buildUserNotes(invoice.notes),
    [invoice.notes],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="app-icon-button app-icon-button-accent"
        title="View invoice attachment"
        aria-label="View invoice attachment"
      >
        <Eye className="h-4 w-4" />
      </button>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-dark/60">
            <div className="modal-card-scroll max-w-5xl rounded-[30px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-center justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
                <div className="text-xs font-semibold uppercase tracking-[0.28em] text-dark-5 dark:text-dark-6">
                  Record Manifest
                </div>
                <div className="flex items-center gap-2">
                  {invoice.pdfUrl ? (
                    <a
                      href={invoice.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-stroke p-2 text-dark-5 transition hover:bg-gray-2 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
                      title="Open attachment in new tab"
                      aria-label="Open attachment in new tab"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="rounded-full border border-stroke p-2 text-dark-5 transition hover:bg-gray-2 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
                    aria-label="Close invoice viewer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="custom-scrollbar overflow-y-auto px-6 py-6">
                <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                  <div className="space-y-6">
                    <section className="rounded-[24px] border border-stroke bg-white/80 p-5 dark:border-dark-3 dark:bg-dark-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-dark-5 dark:text-dark-6">
                        Client Entity
                      </div>
                      <div className="mt-3 text-2xl font-semibold uppercase tracking-tight text-dark dark:text-white">
                        {invoice.vendorName}
                      </div>
                      <div className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                        {invoice.description || invoice.invoiceNumber}
                      </div>
                    </section>

                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-[20px] bg-gray-1 px-4 py-4 dark:bg-dark-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-dark-5 dark:text-dark-6">
                          ID Reference
                        </div>
                        <div className="mt-2 text-base font-semibold text-dark dark:text-white">
                          #{invoice.invoiceNumber}
                        </div>
                      </div>
                      <div className="rounded-[20px] bg-gray-1 px-4 py-4 dark:bg-dark-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-dark-5 dark:text-dark-6">
                          Validation Date
                        </div>
                        <div className="mt-2 text-base font-semibold text-dark dark:text-white">
                          {formatDate(invoice.issueDate)}
                        </div>
                      </div>
                      <div className="rounded-[20px] bg-gray-1 px-4 py-4 dark:bg-dark-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-dark-5 dark:text-dark-6">
                          Due Date
                        </div>
                        <div className="mt-2 text-base font-semibold text-dark dark:text-white">
                          {formatDate(invoice.dueDate)}
                        </div>
                      </div>
                      <div className="rounded-[20px] bg-gray-1 px-4 py-4 dark:bg-dark-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-dark-5 dark:text-dark-6">
                          Status
                        </div>
                        <div className="mt-2 text-base font-semibold uppercase text-dark dark:text-white">
                          {invoice.status}
                        </div>
                      </div>
                    </section>

                    {extractedLineItems.length > 0 ? (
                      <section className="rounded-[24px] border border-stroke p-5 dark:border-dark-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-dark-5 dark:text-dark-6">
                          Line Data Extraction
                        </div>
                        <div className="mt-4 space-y-3">
                          {extractedLineItems.map((item) => (
                            <div
                              key={item}
                              className="text-sm font-medium text-dark dark:text-white"
                            >
                              {item}
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    <section className="rounded-[24px] border border-stroke p-5 dark:border-dark-3">
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-dark-5 dark:text-dark-6">
                            Final Net Total
                          </div>
                          <div className="mt-2 text-3xl font-semibold tracking-tight text-primary">
                            {formatMoney(invoice.total, invoice.currency)}
                          </div>
                        </div>
                        <div className="text-right text-sm text-dark-5 dark:text-dark-6">
                          Paid:{" "}
                          {formatMoney(invoice.paidAmount, invoice.currency)}
                        </div>
                      </div>
                    </section>

                    {noteSections.length > 0 ? (
                      <section className="rounded-[24px] border border-stroke p-5 dark:border-dark-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-dark-5 dark:text-dark-6">
                          Notes
                        </div>
                        <div className="mt-4 space-y-3 text-sm text-dark-5 dark:text-dark-6">
                          {noteSections.map((section) => (
                            <p key={section}>{section}</p>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </div>

                  <section className="rounded-[24px] border border-stroke p-5 dark:border-dark-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-dark-5 dark:text-dark-6">
                      Source Payload Reference
                    </div>
                    <div className="mt-4 overflow-hidden rounded-[22px] border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                      {attachmentKind === "image" && invoice.pdfUrl ? (
                        <div className="flex min-h-[560px] items-center justify-center bg-gray-1 p-4 dark:bg-dark">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={invoice.pdfUrl}
                            alt={`${invoice.invoiceNumber} attachment`}
                            className="max-h-[72vh] w-full rounded-[18px] object-contain"
                          />
                        </div>
                      ) : null}

                      {attachmentKind === "pdf" && invoice.pdfUrl ? (
                        <iframe
                          src={`${invoice.pdfUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                          title={`${invoice.invoiceNumber} attachment preview`}
                          className="h-[72vh] min-h-[560px] w-full"
                        />
                      ) : null}

                      {attachmentKind === "other" && invoice.pdfUrl ? (
                        <div className="flex min-h-[560px] flex-col items-center justify-center gap-4 bg-gray-1 px-6 py-10 text-center dark:bg-dark">
                          <p className="max-w-md text-sm text-dark-5 dark:text-dark-6">
                            Preview is not available for this file type.
                          </p>
                          <a
                            href={invoice.pdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open attachment
                          </a>
                        </div>
                      ) : null}

                      {attachmentKind === "none" ? (
                        <div className="flex min-h-[560px] items-center justify-center bg-gray-1 px-6 py-10 text-center dark:bg-dark">
                          <p className="max-w-md text-sm text-dark-5 dark:text-dark-6">
                            No source attachment is available for this invoice.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </VendorModal>
      ) : null}
    </>
  );
}
