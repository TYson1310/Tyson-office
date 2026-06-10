import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import {
  includeScratchPackInLotteryEft,
  includeScratchPacksInLotteryEft,
  LotteryEftWorkflowError,
  reverseSoldOutPackLotteryEft,
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
  inventoryIds?: unknown;
  sweepDate?: unknown;
};

type ReverseEftPackBody = {
  inventoryId?: unknown;
  reason?: unknown;
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

    if (Array.isArray(body.inventoryIds)) {
      const result = await includeScratchPacksInLotteryEft(access, {
        inventoryIds: body.inventoryIds,
        sweepDate: body.sweepDate,
      });

      await appendAuditEvent({
        supabase: access.supabase,
        storeKey: access.activeStoreKey,
        entityType: "lottery_eft_pack_inclusion",
        entityId: sweepDate,
        action: "lottery.eft_pack_bulk_settled",
        summary: `${result.settled.length} scratch pack settlement${result.settled.length === 1 ? "" : "s"} approved for EFT sweep ${sweepDate}`,
        actorId: access.currentUser.id,
        actorName:
          access.currentUser.user_metadata?.full_name ??
          access.currentUser.email ??
          "User",
        actorRole: access.currentUserRole,
        metadata: result,
      });

      return NextResponse.json(result);
    }

    const result = await includeScratchPackInLotteryEft(access, {
      inventoryId: body.inventoryId,
      sweepDate: body.sweepDate,
    });

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "lottery_eft_pack_inclusion",
      entityId: result.auditId,
      action: "lottery.eft_pack_settled",
      summary: `Scratch pack ${result.packNumber} settled to EFT sweep ${result.sweepDate}`,
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
      "Failed to settle scratch pack to EFT",
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await requireScratchCardAccess(
      ["admin", "manager", "accountant"],
      "/lottery/eft",
    );

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as ReverseEftPackBody;
    const result = await reverseSoldOutPackLotteryEft(access, {
      inventoryId: body.inventoryId,
      reason: body.reason,
    });

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "lottery_eft_pack_inclusion",
      entityId: result.auditId,
      action: "lottery.eft_pack_reversed",
      summary: `Scratch pack ${result.packNumber} reversed from EFT sweep ${result.sweepDate}`,
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
      "Failed to reverse scratch pack EFT settlement",
    );
  }
}
