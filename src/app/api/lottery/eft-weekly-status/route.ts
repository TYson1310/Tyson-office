import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import {
  LotteryEftWorkflowError,
  updateLotteryEftWeeklyStatus,
} from "@/lib/lottery/eft";
import {
  getLotteryEftSweepPeriod,
  isLotteryEftSweepDate,
} from "@/lib/lottery/eft-periods";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";

export const runtime = "nodejs";

type UpdateEftWeeklyStatusBody = {
  paidAmount?: unknown;
  paidNotes?: unknown;
  paidReference?: unknown;
  status?: unknown;
  sweepDate?: unknown;
};

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireScratchCardAccess(["admin"], "/lottery/eft");

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as UpdateEftWeeklyStatusBody;
    const sweepDate =
      typeof body.sweepDate === "string" ? body.sweepDate.trim() : "";
    const periodLockDate = isLotteryEftSweepDate(sweepDate)
      ? getLotteryEftSweepPeriod(sweepDate).weekEndDate
      : sweepDate;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      periodLockDate,
      "Lottery EFT status",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await updateLotteryEftWeeklyStatus(access, {
      paidAmount: body.paidAmount,
      paidNotes: body.paidNotes,
      paidReference: body.paidReference,
      status: body.status,
      sweepDate: body.sweepDate,
    });

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "lottery_eft_week",
      entityId: result.sweepDate,
      action: "lottery.eft_status_updated",
      summary: `Lottery EFT week ${result.sweepDate} marked ${result.paymentStatus}`,
      actorId: access.currentUser.id,
      actorName:
        access.currentUser.user_metadata?.full_name ??
        access.currentUser.email ??
        "User",
      actorRole: access.currentUserRole,
      metadata: {
        paidAmount: result.paidAmount,
        paidAt: result.paidAt,
        paidNotes: result.paidNotes,
        paidReference: result.paidReference,
        paymentStatus: result.paymentStatus,
        sweepDate: result.sweepDate,
        weekEndDate: result.weekEndDate,
        weekStartDate: result.weekStartDate,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LotteryEftWorkflowError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    return scratchCardErrorResponse(error, "Failed to update EFT paid status");
  }
}
