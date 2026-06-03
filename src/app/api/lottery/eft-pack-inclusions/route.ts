import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import {
  includeSoldOutPackInLotteryEft,
  LotteryEftWorkflowError,
} from "@/lib/lottery/eft";
import {
  getLotteryEftSweepPeriod,
  isLotteryEftSweepDate,
} from "@/lib/lottery/eft-periods";
import {
  requireOpenAccountingPeriod,
  requireScratchCardAccess,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";

export const runtime = "nodejs";

type IncludeEftPackBody = {
  inventoryId?: unknown;
  sweepDate?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const access = await requireScratchCardAccess(
      ["admin", "manager", "accountant"],
      "/lottery/eft",
    );

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as IncludeEftPackBody;
    const sweepDate =
      typeof body.sweepDate === "string" ? body.sweepDate.trim() : "";
    const periodLockDate = isLotteryEftSweepDate(sweepDate)
      ? getLotteryEftSweepPeriod(sweepDate).weekEndDate
      : sweepDate;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      periodLockDate,
      "Lottery EFT pack settlement",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await includeSoldOutPackInLotteryEft(access, {
      inventoryId: body.inventoryId,
      sweepDate: body.sweepDate,
    });

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "lottery_eft_pack_inclusion",
      entityId: result.auditId,
      action: "lottery.eft_pack_settled",
      summary: `Sold-out pack ${result.packNumber} settled to EFT sweep ${result.sweepDate}`,
      actorId: access.currentUser.id,
      actorName:
        access.currentUser.user_metadata?.full_name ??
        access.currentUser.email ??
        "User",
      actorRole: access.currentUserRole,
      metadata: result,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LotteryEftWorkflowError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    return scratchCardErrorResponse(
      error,
      "Failed to settle sold-out pack to EFT",
    );
  }
}
