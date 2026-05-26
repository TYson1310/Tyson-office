import { NextResponse } from "next/server";
import { canAccessPath } from "@/lib/auth/route-access";
import { isPrivateAdminPortalConfigured } from "@/lib/private-admin-portal";
import { getUserSafely } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  getPayrollDocumentsBucket,
  getVendorInvoiceDocumentsBucket,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import type { UserRole } from "@/types/erp.types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadStorageHealth() {
  const payrollBucket = getPayrollDocumentsBucket();
  const vendorBucket = getVendorInvoiceDocumentsBucket();

  if (!isSupabaseAdminConfigured()) {
    return {
      accessible: false,
      payrollDocuments: false,
      vendorInvoices: false,
      reason: "SUPABASE_SERVICE_ROLE_KEY is not configured",
      expectedBuckets: [payrollBucket, vendorBucket],
    };
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient.storage.listBuckets();

    if (error) {
      return {
        accessible: false,
        payrollDocuments: false,
        vendorInvoices: false,
        reason: error.message ?? "Failed to list storage buckets",
        expectedBuckets: [payrollBucket, vendorBucket],
      };
    }

    const bucketNames = new Set((data ?? []).map((bucket) => bucket.name));

    return {
      accessible: true,
      payrollDocuments: bucketNames.has(payrollBucket),
      vendorInvoices: bucketNames.has(vendorBucket),
      reason: null,
      expectedBuckets: [payrollBucket, vendorBucket],
    };
  } catch (error) {
    return {
      accessible: false,
      payrollDocuments: false,
      vendorInvoices: false,
      reason:
        error instanceof Error ? error.message : "Failed to inspect storage buckets",
      expectedBuckets: [payrollBucket, vendorBucket],
    };
  }
}

async function canViewDetailedHealth() {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await getUserSafely(supabase);

  if (userError || !user) {
    return false;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,permissions")
    .eq("id", user.id)
    .maybeSingle<{ role: UserRole | null; permissions: string[] | null }>();

  if (profileError) {
    return false;
  }

  return canAccessPath("/admin/settings", profile?.role, profile?.permissions);
}

export async function GET() {
  const showDetails = await canViewDetailedHealth().catch(() => false);

  if (!showDetails) {
    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const storage = await loadStorageHealth();

  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        supabase: isSupabaseConfigured(),
        supabaseAdmin: isSupabaseAdminConfigured(),
        privateAdmin: isPrivateAdminPortalConfigured(),
        gemini: Boolean(process.env.GEMINI_API_KEY),
      },
      storage,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
