import { NextRequest, NextResponse } from "next/server";
import { getUserSafely } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getServerStoreContext } from "@/lib/stores/server";
import { appendAuditEvent } from "@/lib/audit/events";

type EodReviewRow = {
  id: string;
  business_date: string;
  pos_cash_counted: number | string;
  opening_float: number | string;
  closing_float: number | string;
  total_payouts: number | string;
  nrs_import_id: string | null;
  nrs_cash_total: number | string | null;
  variance: number | string | null;
  notes: string | null;
  status: "counted" | "approved";
  counted_by: string | null;
  counted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  update_count: number;
};

const REVIEW_SELECT =
  "id,business_date,pos_cash_counted,opening_float,closing_float,total_payouts,nrs_import_id,nrs_cash_total,variance,notes,status,counted_by,counted_at,reviewed_by,reviewed_at,update_count";

function numberValue(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : 0;
}

function mapReview(row: EodReviewRow) {
  return {
    id: row.id,
    businessDate: row.business_date,
    posCashCounted: numberValue(row.pos_cash_counted),
    openingFloat: numberValue(row.opening_float),
    closingFloat: numberValue(row.closing_float),
    totalPayouts: numberValue(row.total_payouts),
    nrsImportId: row.nrs_import_id,
    nrsCashTotal:
      row.nrs_cash_total === null ? null : numberValue(row.nrs_cash_total),
    variance: row.variance === null ? null : numberValue(row.variance),
    notes: row.notes,
    status: row.status,
    countedAt: row.counted_at,
    reviewedAt: row.reviewed_at,
    updateCount: row.update_count,
  };
}

async function getContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await getUserSafely(supabase);

  if (userError || !user) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  }

  const storeContext = await getServerStoreContext();
  if (!storeContext.activeStoreKey) {
    return {
      error: NextResponse.json({ message: "Select an active store" }, { status: 400 }),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();

  if (profileError) {
    return { error: NextResponse.json({ message: profileError.message }, { status: 500 }) };
  }

  return {
    supabase,
    user,
    role: profile.role,
    storeKey: storeContext.activeStoreKey,
  };
}

export async function GET(request: NextRequest) {
  const context = await getContext();
  if ("error" in context) return context.error;

  const date = request.nextUrl.searchParams.get("date");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 30), 100);
  let reviewsQuery = context.supabase
    .from("pos_cash_eod_reviews")
    .select(REVIEW_SELECT)
    .eq("store_key", context.storeKey)
    .order("business_date", { ascending: false })
    .limit(limit);

  if (date) reviewsQuery = reviewsQuery.eq("business_date", date);

  const [{ data: reviews, error: reviewsError }, { data: imports, error: importsError }] =
    await Promise.all([
      reviewsQuery.returns<EodReviewRow[]>(),
      context.supabase
        .from("nrs_email_imports")
        .select("id,business_date,sales_total,cash_tender_total,item_count,status,imported_at")
        .eq("store_key", context.storeKey)
        .eq("status", "imported")
        .order("business_date", { ascending: false })
        .limit(limit),
    ]);

  if (reviewsError || importsError) {
    return NextResponse.json(
      { message: reviewsError?.message ?? importsError?.message ?? "Failed to load EOD data" },
      { status: 500 },
    );
  }

  const review = reviews?.[0];
  const { data: history, error: historyError } = review
    ? await context.supabase
        .from("audit_events")
        .select("id,action,summary,actor_name,actor_role,metadata,created_at")
        .eq("store_key", context.storeKey)
        .eq("entity_type", "pos_cash_eod_review")
        .eq("entity_id", review.id)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };

  if (historyError) {
    return NextResponse.json({ message: historyError.message }, { status: 500 });
  }

  return NextResponse.json({
    reviews: (reviews ?? []).map(mapReview),
    imports: imports ?? [],
    history: history ?? [],
  });
}

export async function POST(request: NextRequest) {
  const context = await getContext();
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => null);
  const businessDate = String(body?.businessDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return NextResponse.json({ message: "A valid business date is required" }, { status: 400 });
  }

  const { data: lotteryEod, error: lotteryEodError } = await context.supabase
    .from("terminal_reports")
    .select("id")
    .eq("store_key", context.storeKey)
    .eq("report_date", businessDate)
    .maybeSingle<{ id: string }>();

  if (lotteryEodError) {
    return NextResponse.json({ message: lotteryEodError.message }, { status: 500 });
  }

  if (!lotteryEod) {
    return NextResponse.json(
      { message: "Complete Lottery EOD before entering the POS cash count" },
      { status: 409 },
    );
  }

  const { data: existingReview, error: existingReviewError } = await context.supabase
    .from("pos_cash_eod_reviews")
    .select("id,status,pos_cash_counted,update_count,counted_by")
    .eq("store_key", context.storeKey)
    .eq("business_date", businessDate)
    .maybeSingle<{
      id: string;
      status: "counted" | "approved";
      pos_cash_counted: number | string;
      update_count: number;
      counted_by: string | null;
    }>();

  if (existingReviewError) {
    return NextResponse.json({ message: existingReviewError.message }, { status: 500 });
  }

  if (existingReview?.status === "approved") {
    return NextResponse.json(
      { message: "Finalized closeouts cannot be edited" },
      { status: 409 },
    );
  }

  const changeReason = String(body?.changeReason ?? "").trim();
  if (existingReview && !changeReason) {
    return NextResponse.json(
      { message: "Enter a reason for updating the daily closeout" },
      { status: 400 },
    );
  }

  const payload = {
    store_key: context.storeKey,
    business_date: businessDate,
    pos_cash_counted: numberValue(body?.posCashCounted),
    opening_float: 0,
    closing_float: 0,
    total_payouts: 0,
    nrs_import_id: null as string | null,
    nrs_cash_total: null as number | null,
    variance: null as number | null,
    notes: null,
    counted_by: existingReview ? undefined : context.user.id,
    counted_at: new Date().toISOString(),
    status: "counted" as const,
    update_count: existingReview ? existingReview.update_count + 1 : 0,
    ...(existingReview ? { counted_by: existingReview.counted_by } : {}),
  };

  const { data: nrsImport, error: nrsImportError } = await context.supabase
    .from("nrs_email_imports")
    .select("id,cash_tender_total")
    .eq("store_key", context.storeKey)
    .eq("business_date", businessDate)
    .eq("status", "imported")
    .maybeSingle<{ id: string; cash_tender_total: number | string | null }>();

  if (nrsImportError) {
    return NextResponse.json({ message: nrsImportError.message }, { status: 500 });
  }

  payload.nrs_import_id = nrsImport?.id ?? null;
  const cashTenderTotal =
    nrsImport?.cash_tender_total === null ||
    nrsImport?.cash_tender_total === undefined
      ? null
      : numberValue(nrsImport.cash_tender_total);
  payload.nrs_cash_total = cashTenderTotal;
  payload.variance =
    cashTenderTotal === null
      ? null
      : numberValue(payload.pos_cash_counted) - cashTenderTotal;

  const { data, error } = await context.supabase
    .from("pos_cash_eod_reviews")
    .upsert(payload, { onConflict: "store_key,business_date" })
    .select(REVIEW_SELECT)
    .single<EodReviewRow>();

  if (error || !data) {
    return NextResponse.json({ message: error?.message ?? "Failed to save POS cash count" }, { status: 500 });
  }

  await appendAuditEvent({
    supabase: context.supabase,
    storeKey: context.storeKey,
    entityType: "pos_cash_eod_review",
    entityId: data.id,
    action: existingReview ? "daily_closeout.updated" : "daily_closeout.closed",
    summary: existingReview
      ? `Daily closeout updated for ${businessDate}`
      : `Daily closeout closed for ${businessDate}`,
    actorId: context.user.id,
    actorRole: context.role,
    metadata: {
      updateNumber: data.update_count,
      changeReason: changeReason || null,
      changes: {
        posCashCounted: {
          from: existingReview ? numberValue(existingReview.pos_cash_counted) : null,
          to: numberValue(data.pos_cash_counted),
        },
      },
    },
  });

  return NextResponse.json(mapReview(data), { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getContext();
  if ("error" in context) return context.error;
  if (!["admin", "manager"].includes(context.role)) {
    return NextResponse.json({ message: "Only admin or manager accounts can approve EOD reviews" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const reviewId = String(body?.id ?? "").trim();
  if (!reviewId || body?.verified !== true) {
    return NextResponse.json(
      { message: "Verify the imported NRS data before final closeout" },
      { status: 400 },
    );
  }

  const { data: review, error: reviewError } = await context.supabase
    .from("pos_cash_eod_reviews")
    .select(REVIEW_SELECT)
    .eq("id", reviewId)
    .eq("store_key", context.storeKey)
    .single<EodReviewRow>();

  if (reviewError || !review) {
    return NextResponse.json({ message: reviewError?.message ?? "EOD review not found" }, { status: 404 });
  }

  if (review.nrs_cash_total === null) {
    return NextResponse.json(
      { message: "The NRS email has not arrived for this business date" },
      { status: 409 },
    );
  }

  const { data, error } = await context.supabase
    .from("pos_cash_eod_reviews")
    .update({
      status: "approved",
      reviewed_by: context.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("store_key", context.storeKey)
    .select(REVIEW_SELECT)
    .single<EodReviewRow>();

  if (error || !data) {
    return NextResponse.json({ message: error?.message ?? "Failed to approve EOD review" }, { status: 500 });
  }

  return NextResponse.json(mapReview(data));
}
