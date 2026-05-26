import { NextRequest, NextResponse } from "next/server";
import { requireExpenseManagerAccess } from "@/lib/expenses/api";
import {
  getExpenseDocumentsBucket,
  getSupabaseUrl,
} from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExpenseDocumentRow = {
  id: string;
  attachment_name: string | null;
  attachment_path: string | null;
  attachment_url: string | null;
  attachment_mime_type: string | null;
};

function isDownloadRequest(value: string | null) {
  return value === "1" || value === "true";
}

function sanitizeAttachmentName(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.replace(/["\r\n]+/g, "") : "expense-document";
}

function getTrustedStorageUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const attachmentUrl = new URL(value);
    const supabaseUrl = new URL(getSupabaseUrl());
    const isTrustedStorageUrl =
      attachmentUrl.protocol === "https:" &&
      attachmentUrl.hostname === supabaseUrl.hostname &&
      attachmentUrl.pathname.startsWith("/storage/v1/object/");

    return isTrustedStorageUrl ? attachmentUrl : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireExpenseManagerAccess();

    if ("error" in access) {
      return access.error;
    }

    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";

    if (!id) {
      return NextResponse.json(
        { error: "Expense id is required" },
        { status: 400 },
      );
    }

    const { data, error } = await access.supabase
      .from("expense_records")
      .select("id,attachment_name,attachment_path,attachment_url,attachment_mime_type")
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .maybeSingle<ExpenseDocumentRow>();

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to load expense document" },
        { status: 500 },
      );
    }

    if (!data || (!data.attachment_path && !data.attachment_url)) {
      return NextResponse.json(
        { error: "Expense document not found" },
        { status: 404 },
      );
    }

    if (!data.attachment_path && data.attachment_url) {
      const trustedStorageUrl = getTrustedStorageUrl(data.attachment_url);

      if (!trustedStorageUrl) {
        return NextResponse.json(
          { error: "Expense document URL is not trusted" },
          { status: 400 },
        );
      }

      return NextResponse.redirect(trustedStorageUrl);
    }

    const { data: fileData, error: downloadError } = await access.supabase.storage
      .from(getExpenseDocumentsBucket())
      .download(data.attachment_path as string);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: downloadError?.message ?? "Failed to load expense document" },
        { status: 500 },
      );
    }

    const download = isDownloadRequest(
      request.nextUrl.searchParams.get("download"),
    );
    const fileName = sanitizeAttachmentName(data.attachment_name);

    return new NextResponse(fileData.stream(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type":
          (data.attachment_mime_type ?? fileData.type) ||
          "application/octet-stream",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Expense document GET error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load expense document",
      },
      { status: 500 },
    );
  }
}
