"use client";

import { useMemo, useState } from "react";
import { Download, Eye, ExternalLink, FileText, X } from "lucide-react";
import { VendorModal } from "@/components/vendors/vendor-modal";

type VendorAttachmentActionsProps = {
  href: string;
  label: string;
  title?: string;
  downloadHref?: string;
  kindHint?: string;
};

function getAttachmentKind(href: string, kindHint?: string) {
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

  const normalized = href.split("?")[0]?.toLowerCase() ?? "";

  if (normalized.endsWith(".pdf")) {
    return "pdf" as const;
  }

  if (
    normalized.endsWith(".png") ||
    normalized.endsWith(".jpg") ||
    normalized.endsWith(".jpeg") ||
    normalized.endsWith(".webp") ||
    normalized.endsWith(".gif")
  ) {
    return "image" as const;
  }

  return "other" as const;
}

export function VendorAttachmentActions({
  href,
  label,
  title = "Supplier attachment",
  downloadHref,
  kindHint,
}: VendorAttachmentActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const attachmentKind = useMemo(
    () => getAttachmentKind(href, kindHint),
    [href, kindHint],
  );
  const canPreview = attachmentKind === "pdf" || attachmentKind === "image";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-2 px-2.5 py-1 text-xs font-medium text-dark-5 dark:bg-dark-2 dark:text-dark-6">
          <FileText className="h-3.5 w-3.5" />
          {label}
        </span>
        {canPreview ? (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="app-icon-button app-icon-button-accent"
            title="Preview attachment"
            aria-label="Preview attachment"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="app-icon-button"
            title="Open attachment"
            aria-label="Open attachment"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <a
          href={downloadHref ?? href}
          download
          className="app-icon-button"
          title="Download attachment"
          aria-label="Download attachment"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-dark/60">
            <div className="modal-card-scroll max-w-5xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-center justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
                <div>
                  <div className="text-sm font-semibold text-dark dark:text-white">
                    {title}
                  </div>
                  <div className="text-xs text-dark-5 dark:text-dark-6">
                    {label}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="app-icon-button"
                  aria-label="Close attachment preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-6 py-6">
                {attachmentKind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={href}
                    alt={label}
                    className="max-h-[70vh] w-full rounded-[18px] object-contain"
                  />
                ) : (
                  <iframe
                    src={href}
                    title={label}
                    className="h-[70vh] w-full rounded-[18px] border border-stroke dark:border-dark-3"
                  />
                )}
              </div>
            </div>
          </div>
        </VendorModal>
      ) : null}
    </>
  );
}
