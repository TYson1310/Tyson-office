import { NextRequest, NextResponse } from "next/server";
import { canAccessPath } from "@/lib/auth/route-access";
import { getUserSafely } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getServerStoreContext } from "@/lib/stores/server";
import type { UserRole } from "@/types/erp.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEPOSIT_SLIPS_BUCKET = "deposit-slips";

type BankDepositSlipRow = {
  id: string;
  slip_photo_path: string | null;
};

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function requireBankDepositAccess() {
  if (!isSupabaseConfigured()) {
    return {
      error: NextResponse.json(
        { error: "Supabase configuration required" },
        { status: 503 },
      ),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await getUserSafely(supabase);

  if (userError || !user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,permissions")
    .eq("id", user.id)
    .maybeSingle<{ role: UserRole | null; permissions: string[] | null }>();

  if (profileError) {
    return {
      error: NextResponse.json(
        { error: profileError.message ?? "Failed to verify deposit access" },
        { status: 500 },
      ),
    };
  }

  if (
    !canAccessPath("/admin/bank-deposits", profile?.role, profile?.permissions)
  ) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: bank deposit access denied" },
        { status: 403 },
      ),
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json(
        { error: "Select a store before viewing deposit slips" },
        { status: 400 },
      ),
    };
  }

  return {
    supabase,
    activeStoreKey: storeContext.activeStoreKey,
  };
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireBankDepositAccess();

    if ("error" in access) {
      return access.error;
    }

    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";

    if (!id) {
      return NextResponse.json(
        { error: "Deposit id is required" },
        { status: 400 },
      );
    }

    const { data: deposit, error: depositError } = await access.supabase
      .from("bank_deposits")
      .select("id,slip_photo_path")
      .eq("id", id)
      .eq("store_key", access.activeStoreKey)
      .maybeSingle<BankDepositSlipRow>();

    if (depositError) {
      return NextResponse.json(
        { error: depositError.message ?? "Failed to load deposit slip" },
        { status: 500 },
      );
    }

    if (!deposit?.slip_photo_path) {
      return NextResponse.json(
        { error: "Deposit slip not found" },
        { status: 404 },
      );
    }

    const { data: fileData, error: downloadError } =
      await access.supabase.storage
        .from(DEPOSIT_SLIPS_BUCKET)
        .download(deposit.slip_photo_path);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: downloadError?.message ?? "Failed to load deposit slip" },
        { status: 500 },
      );
    }

    const fileName = sanitizeFileName(`deposit-slip-${deposit.id}`);

    return new NextResponse(fileData.stream(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": fileData.type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Bank deposit slip GET error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load deposit slip",
      },
      { status: 500 },
    );
  }
}
