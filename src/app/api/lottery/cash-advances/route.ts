import { NextRequest, NextResponse } from "next/server";
import { assertAccountingPeriodUnlocked } from "@/lib/accounting/period-locks";
import { appendAuditEvent } from "@/lib/audit/events";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import {
  isMissingLotteryCashAdvanceMigration,
  LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE,
  roundLotteryCashAdvanceMoney,
} from "@/lib/lottery/cash-advances";
import {
  requireOpenAccountingPeriod,
  requireScratchCardAccess,
  scratchCardErrorResponse,
  type ScratchCardAccess,
} from "@/lib/scratch-cards/api";

export const runtime = "nodejs";

type LotteryCashAdvanceMutationRow = {
  id: string;
  advance_date: string;
  person_name: string;
  amount: number | string;
  reason: string;
  expected_payback_date: string | null;
  notes: string | null;
  status: "posted" | "void";
  void_reason: string | null;
  created_at: string;
};

type LotteryCashAdvancePaymentRow = {
  id: string;
  advance_id: string;
  payment_date: string;
  amount: number | string;
  status: "posted" | "void";
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRequiredText(value: unknown, label: string) {
  const normalized = normalizeString(value).replace(/\s+/g, " ");

  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  return normalized;
}

function normalizeOptionalText(value: unknown) {
  const normalized = normalizeString(value).replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeAmount(value: unknown, label: string) {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }

  return roundLotteryCashAdvanceMoney(amount);
}

function normalizeDate(value: unknown, todayDate: string, label: string) {
  const normalized = normalizeString(value) || todayDate;

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(normalized)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }

  if (normalized > todayDate) {
    throw new Error(`${label} cannot be in the future`);
  }

  return normalized;
}

function normalizeOptionalDate(value: unknown, label: string) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(normalized)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }

  return normalized;
}

function getActorName(access: ScratchCardAccess) {
  return (
    access.currentUser.user_metadata?.full_name ??
    access.currentUser.email ??
    "User"
  );
}

async function loadAdvance(
  access: ScratchCardAccess,
  advanceId: string,
): Promise<LotteryCashAdvanceMutationRow | null> {
  const { data, error } = await access.supabase
    .from("lottery_cash_advances")
    .select(
      "id,advance_date,person_name,amount,reason,expected_payback_date,notes,status,void_reason,created_at",
    )
    .eq("store_key", access.activeStoreKey)
    .eq("id", advanceId)
    .maybeSingle<LotteryCashAdvanceMutationRow>();

  if (isMissingLotteryCashAdvanceMigration(error)) {
    throw new Error(LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE);
  }

  if (error) {
    throw new Error(error.message ?? "Failed to load lottery cash advance");
  }

  return data;
}

async function loadPostedPayments(
  access: ScratchCardAccess,
  advanceId: string,
) {
  const { data, error } = await access.supabase
    .from("lottery_cash_advance_payments")
    .select("id,advance_id,payment_date,amount,status")
    .eq("store_key", access.activeStoreKey)
    .eq("advance_id", advanceId)
    .eq("status", "posted")
    .returns<LotteryCashAdvancePaymentRow[]>();

  if (isMissingLotteryCashAdvanceMigration(error)) {
    throw new Error(LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE);
  }

  if (error) {
    throw new Error(
      error.message ?? "Failed to load lottery cash advance payments",
    );
  }

  return data ?? [];
}

function sumPayments(payments: LotteryCashAdvancePaymentRow[]) {
  return roundLotteryCashAdvanceMoney(
    payments.reduce(
      (total, payment) => total + roundLotteryCashAdvanceMoney(payment.amount),
      0,
    ),
  );
}

async function assertLotteryCashDateEditable(
  access: ScratchCardAccess,
  businessDate: string,
) {
  if (access.currentUserRole === "admin") {
    return null;
  }

  const { data, error } = await access.supabase
    .from("eod_reconciliation")
    .select("report_date")
    .eq("store_key", access.activeStoreKey)
    .eq("report_date", businessDate)
    .maybeSingle<{ report_date: string }>();

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to check lottery EOD status" },
      { status: 500 },
    );
  }

  if (data) {
    return NextResponse.json(
      {
        error:
          "Lottery cash is already reconciled for this date. Admin must update the date and resave reconciliation.",
      },
      { status: 409 },
    );
  }

  return null;
}

async function assertPaymentDatesUnlocked(
  access: ScratchCardAccess,
  payments: LotteryCashAdvancePaymentRow[],
) {
  for (const payment of payments) {
    const periodLock = await assertAccountingPeriodUnlocked(
      access.supabase,
      access.activeStoreKey,
      payment.payment_date,
      `Lottery cash advance payback ${payment.payment_date}`,
    );

    if (periodLock) {
      return NextResponse.json(
        { error: periodLock.error },
        { status: periodLock.status },
      );
    }
  }

  return null;
}

async function assertPaymentDatesEditable(
  access: ScratchCardAccess,
  payments: LotteryCashAdvancePaymentRow[],
) {
  const checkedDates = new Set<string>();

  for (const payment of payments) {
    if (checkedDates.has(payment.payment_date)) {
      continue;
    }

    checkedDates.add(payment.payment_date);
    const dateLock = await assertLotteryCashDateEditable(
      access,
      payment.payment_date,
    );

    if (dateLock) {
      return dateLock;
    }
  }

  return null;
}

async function requireLotteryCashAdvanceAccess() {
  return requireScratchCardAccess(
    ["admin", "manager"],
    "/lottery/cash-advances",
  );
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireLotteryCashAdvanceAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = await request.json();
    const todayDate = getTodayIsoDateInTimeZone(access.activeStoreTimeZone);
    const advanceDate = normalizeDate(
      body?.advanceDate,
      todayDate,
      "Advance date",
    );
    const expectedPaybackDate = normalizeOptionalDate(
      body?.expectedPaybackDate,
      "Expected payback date",
    );
    const amount = normalizeAmount(body?.amount, "Advance amount");
    const personName = normalizeRequiredText(
      body?.personName,
      "Authorized person",
    );
    const reason = normalizeRequiredText(body?.reason, "Reason");
    const notes = normalizeOptionalText(body?.notes);

    if (expectedPaybackDate && expectedPaybackDate < advanceDate) {
      return NextResponse.json(
        { error: "Expected payback date cannot be before advance date" },
        { status: 400 },
      );
    }

    const periodLock = await requireOpenAccountingPeriod(
      access,
      advanceDate,
      `Lottery cash advance ${advanceDate}`,
    );

    if (periodLock) {
      return periodLock;
    }

    const dateLock = await assertLotteryCashDateEditable(access, advanceDate);

    if (dateLock) {
      return dateLock;
    }

    const { data, error } = await access.supabase
      .from("lottery_cash_advances")
      .insert({
        advance_date: advanceDate,
        amount,
        created_by: access.currentUser.id,
        expected_payback_date: expectedPaybackDate,
        notes,
        person_name: personName,
        reason,
        status: "posted",
        store_key: access.activeStoreKey,
      })
      .select(
        "id,advance_date,person_name,amount,reason,expected_payback_date,notes,status,void_reason,created_at",
      )
      .single<LotteryCashAdvanceMutationRow>();

    if (isMissingLotteryCashAdvanceMigration(error)) {
      return NextResponse.json(
        { error: LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE },
        { status: 503 },
      );
    }

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to record lottery cash advance" },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "lottery_cash_advance",
      entityId: data.id,
      action: "lottery_cash_advance.created",
      summary: `Lottery cash advance recorded for ${personName}`,
      actorId: access.currentUser.id,
      actorName: getActorName(access),
      actorRole: access.currentUserRole,
      metadata: {
        advanceDate,
        amount,
        expectedPaybackDate,
        personName,
        reason,
      },
    });

    return NextResponse.json(
      {
        advanceDate: data.advance_date,
        amount: roundLotteryCashAdvanceMoney(data.amount),
        id: data.id,
        personName: data.person_name,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to record lottery cash advance";
    if (message === LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE) {
      return NextResponse.json({ error: message }, { status: 503 });
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireLotteryCashAdvanceAccess();

    if ("error" in access) {
      return access.error;
    }

    const body = await request.json();
    const action = normalizeString(body?.action);
    const advanceId = normalizeString(body?.id);

    if (!advanceId) {
      return NextResponse.json(
        { error: "Lottery cash advance id is required" },
        { status: 400 },
      );
    }

    const advance = await loadAdvance(access, advanceId);

    if (!advance) {
      return NextResponse.json(
        { error: "Lottery cash advance not found" },
        { status: 404 },
      );
    }

    if (advance.status === "void") {
      return NextResponse.json(
        { error: "Lottery cash advance is already void" },
        { status: 409 },
      );
    }

    if (action === "repay") {
      const todayDate = getTodayIsoDateInTimeZone(access.activeStoreTimeZone);
      const paymentDate = normalizeDate(
        body?.paymentDate,
        todayDate,
        "Payback date",
      );
      const amount = normalizeAmount(body?.amount, "Payback amount");
      const notes = normalizeOptionalText(body?.notes);
      const payments = await loadPostedPayments(access, advance.id);
      const amountRepaid = sumPayments(payments);
      const balance = roundLotteryCashAdvanceMoney(
        roundLotteryCashAdvanceMoney(advance.amount) - amountRepaid,
      );

      if (paymentDate < advance.advance_date) {
        return NextResponse.json(
          { error: "Payback date cannot be before the advance date" },
          { status: 400 },
        );
      }

      if (balance <= 0) {
        return NextResponse.json(
          { error: "Lottery cash advance is already paid back" },
          { status: 409 },
        );
      }

      if (amount > balance) {
        return NextResponse.json(
          {
            error: `Payback cannot exceed outstanding balance of $${balance.toFixed(
              2,
            )}`,
          },
          { status: 400 },
        );
      }

      const periodLock = await requireOpenAccountingPeriod(
        access,
        paymentDate,
        `Lottery cash advance payback ${paymentDate}`,
      );

      if (periodLock) {
        return periodLock;
      }

      const dateLock = await assertLotteryCashDateEditable(access, paymentDate);

      if (dateLock) {
        return dateLock;
      }

      const { data, error } = await access.supabase
        .from("lottery_cash_advance_payments")
        .insert({
          advance_id: advance.id,
          amount,
          created_by: access.currentUser.id,
          notes,
          payment_date: paymentDate,
          status: "posted",
          store_key: access.activeStoreKey,
        })
        .select("id,advance_id,payment_date,amount,status")
        .single<LotteryCashAdvancePaymentRow>();

      if (isMissingLotteryCashAdvanceMigration(error)) {
        return NextResponse.json(
          { error: LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE },
          { status: 503 },
        );
      }

      if (error || !data) {
        return NextResponse.json(
          { error: error?.message ?? "Failed to record payback" },
          { status: 500 },
        );
      }

      await appendAuditEvent({
        supabase: access.supabase,
        storeKey: access.activeStoreKey,
        entityType: "lottery_cash_advance",
        entityId: advance.id,
        action: "lottery_cash_advance.payback_recorded",
        summary: `Lottery cash advance payback recorded for ${advance.person_name}`,
        actorId: access.currentUser.id,
        actorName: getActorName(access),
        actorRole: access.currentUserRole,
        metadata: {
          amount,
          advanceDate: advance.advance_date,
          balanceBefore: balance,
          paymentDate,
          personName: advance.person_name,
        },
      });

      return NextResponse.json({
        amount: roundLotteryCashAdvanceMoney(data.amount),
        id: data.id,
        paymentDate: data.payment_date,
        remainingBalance: roundLotteryCashAdvanceMoney(balance - amount),
      });
    }

    if (action === "void") {
      const voidReason = normalizeRequiredText(body?.voidReason, "Void reason");
      const payments = await loadPostedPayments(access, advance.id);
      const periodLock = await requireOpenAccountingPeriod(
        access,
        advance.advance_date,
        `Lottery cash advance ${advance.advance_date}`,
      );

      if (periodLock) {
        return periodLock;
      }

      const paymentLock = await assertPaymentDatesUnlocked(access, payments);

      if (paymentLock) {
        return paymentLock;
      }

      const paymentDateLock = await assertPaymentDatesEditable(
        access,
        payments,
      );

      if (paymentDateLock) {
        return paymentDateLock;
      }

      const dateLock = await assertLotteryCashDateEditable(
        access,
        advance.advance_date,
      );

      if (dateLock) {
        return dateLock;
      }

      const voidedAt = new Date().toISOString();
      const { error: advanceError } = await access.supabase
        .from("lottery_cash_advances")
        .update({
          status: "void",
          void_reason: voidReason,
          voided_at: voidedAt,
          voided_by: access.currentUser.id,
        })
        .eq("store_key", access.activeStoreKey)
        .eq("id", advance.id);

      if (isMissingLotteryCashAdvanceMigration(advanceError)) {
        return NextResponse.json(
          { error: LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE },
          { status: 503 },
        );
      }

      if (advanceError) {
        return NextResponse.json(
          { error: advanceError.message ?? "Failed to void advance" },
          { status: 500 },
        );
      }

      if (payments.length > 0) {
        const { error: paymentsError } = await access.supabase
          .from("lottery_cash_advance_payments")
          .update({
            status: "void",
            void_reason: voidReason,
            voided_at: voidedAt,
            voided_by: access.currentUser.id,
          })
          .eq("store_key", access.activeStoreKey)
          .eq("advance_id", advance.id)
          .eq("status", "posted");

        if (paymentsError) {
          return NextResponse.json(
            { error: paymentsError.message ?? "Failed to void paybacks" },
            { status: 500 },
          );
        }
      }

      await appendAuditEvent({
        supabase: access.supabase,
        storeKey: access.activeStoreKey,
        entityType: "lottery_cash_advance",
        entityId: advance.id,
        action: "lottery_cash_advance.voided",
        summary: `Lottery cash advance voided for ${advance.person_name}`,
        actorId: access.currentUser.id,
        actorName: getActorName(access),
        actorRole: access.currentUserRole,
        metadata: {
          advanceDate: advance.advance_date,
          amount: roundLotteryCashAdvanceMoney(advance.amount),
          paybacksVoided: payments.length,
          personName: advance.person_name,
          voidReason,
        },
      });

      return NextResponse.json({
        id: advance.id,
        status: "void",
        voidReason,
      });
    }

    return NextResponse.json(
      { error: "Action must be repay or void" },
      { status: 400 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === LOTTERY_CASH_ADVANCE_MIGRATION_MESSAGE
    ) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return scratchCardErrorResponse(
      error,
      "Failed to update lottery cash advance",
    );
  }
}
