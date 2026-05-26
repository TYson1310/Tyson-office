import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import {
  getVendorDocumentHref,
  type VendorDocumentKind,
} from "@/lib/vendors/documents";
import {
  getSupabaseUrl,
  getVendorInvoiceDocumentsBucket,
} from "@/lib/supabase/env";
import { requireVendorManagerAccess } from "@/lib/vendors/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VendorInvoiceDocumentRow = {
  id: string;
  invoice_number: string;
  pdf_file_name?: string | null;
  pdf_mime_type?: string | null;
  pdf_path?: string | null;
  pdf_url: string | null;
};

type VendorAdjustmentDocumentRow = {
  id: string;
  adjustment_number: string;
  attachment_mime_type: string | null;
  attachment_name: string | null;
  attachment_path: string | null;
  attachment_url: string | null;
};

function isDownloadRequest(value: string | null) {
  return value === "1" || value === "true";
}

function sanitizeAttachmentName(
  value: string | null | undefined,
  fallback: string,
) {
  const normalized = value?.trim() ?? "";
  return (normalized.length > 0 ? normalized : fallback).replace(
    /["\r\n]+/g,
    "",
  );
}

function parseVendorStoragePathFromUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const documentUrl = new URL(value);
    const supabaseUrl = new URL(getSupabaseUrl());
    const bucket = getVendorInvoiceDocumentsBucket();
    const publicPrefix = `/storage/v1/object/public/${bucket}/`;
    const signedPrefix = `/storage/v1/object/sign/${bucket}/`;

    if (
      documentUrl.protocol !== "https:" ||
      documentUrl.hostname !== supabaseUrl.hostname
    ) {
      return null;
    }

    if (documentUrl.pathname.startsWith(publicPrefix)) {
      return decodeURIComponent(
        documentUrl.pathname.slice(publicPrefix.length),
      );
    }

    if (documentUrl.pathname.startsWith(signedPrefix)) {
      return decodeURIComponent(
        documentUrl.pathname.slice(signedPrefix.length),
      );
    }
  } catch {
    return null;
  }

  return null;
}

function getDocumentKind(value: string | null): VendorDocumentKind | null {
  if (value === "invoice" || value === "adjustment") {
    return value;
  }

  return null;
}

async function loadInvoiceDocument(
  access: Awaited<ReturnType<typeof requireVendorManagerAccess>> & {
    error?: never;
  },
  id: string,
) {
  const primary = await access.supabase
    .from("vendor_invoices")
    .select("id,invoice_number,pdf_file_name,pdf_mime_type,pdf_path,pdf_url")
    .eq("id", id)
    .eq("store_key", access.activeStoreKey)
    .maybeSingle<VendorInvoiceDocumentRow>();

  if (
    primary.error &&
    primary.error.message?.toLowerCase().includes("pdf_path")
  ) {
    const fallback = await access.supabase
      .from("vendor_invoices")
      .select("id,invoice_number,pdf_url")
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .maybeSingle<VendorInvoiceDocumentRow>();

    return fallback;
  }

  return primary;
}

async function loadAdjustmentDocument(
  access: Awaited<ReturnType<typeof requireVendorManagerAccess>> & {
    error?: never;
  },
  id: string,
) {
  return access.supabase
    .from("vendor_adjustments")
    .select(
      "id,adjustment_number,attachment_name,attachment_path,attachment_url,attachment_mime_type",
    )
    .eq("id", id)
    .eq("store_key", access.activeStoreKey)
    .maybeSingle<VendorAdjustmentDocumentRow>();
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireVendorManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
    const kind = getDocumentKind(request.nextUrl.searchParams.get("kind"));

    if (!id || !kind) {
      return NextResponse.json(
        { error: "Vendor document id and kind are required" },
        { status: 400 },
      );
    }

    const bucket = getVendorInvoiceDocumentsBucket();
    const download = isDownloadRequest(
      request.nextUrl.searchParams.get("download"),
    );
    let entityId = id;
    let entityType = "vendor_document";
    let fileName = "vendor-document";
    let mimeType: string | null = null;
    let storagePath: string | null = null;

    if (kind === "invoice") {
      const { data, error } = await loadInvoiceDocument(access, id);

      if (error) {
        return NextResponse.json(
          { error: error.message ?? "Failed to load vendor invoice document" },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "Vendor invoice document not found" },
          { status: 404 },
        );
      }

      entityType = "vendor_invoice_document";
      entityId = data.id;
      fileName = sanitizeAttachmentName(
        data.pdf_file_name,
        `invoice-${data.invoice_number || data.id}`,
      );
      mimeType = data.pdf_mime_type ?? null;
      storagePath =
        data.pdf_path ?? parseVendorStoragePathFromUrl(data.pdf_url);
    } else {
      const { data, error } = await loadAdjustmentDocument(access, id);

      if (error) {
        return NextResponse.json(
          {
            error: error.message ?? "Failed to load vendor adjustment document",
          },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "Vendor adjustment document not found" },
          { status: 404 },
        );
      }

      entityType = "vendor_adjustment_document";
      entityId = data.id;
      fileName = sanitizeAttachmentName(
        data.attachment_name,
        `adjustment-${data.adjustment_number || data.id}`,
      );
      mimeType = data.attachment_mime_type;
      storagePath =
        data.attachment_path ??
        parseVendorStoragePathFromUrl(data.attachment_url);
    }

    if (!storagePath) {
      return NextResponse.json(
        {
          error:
            "Vendor document is missing a private storage path. Re-upload the file or run the latest storage migration.",
        },
        { status: 404 },
      );
    }

    const { data: fileData, error: downloadError } =
      await access.supabase.storage.from(bucket).download(storagePath);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: downloadError?.message ?? "Failed to load vendor document" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType,
      entityId,
      action: download
        ? "vendor.document_downloaded"
        : "vendor.document_viewed",
      summary: `Vendor document ${download ? "downloaded" : "viewed"}`,
      actorId: access.currentUser.id,
      actorName: access.currentUserName,
      actorRole: access.currentUserRole,
      metadata: {
        bucket,
        documentHref: getVendorDocumentHref(kind, id, { download }),
        documentKind: kind,
        fileName,
        storagePath,
      },
    });

    return new NextResponse(fileData.stream(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": mimeType || fileData.type || "application/octet-stream",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Vendor document GET error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load vendor document",
      },
      { status: 500 },
    );
  }
}
