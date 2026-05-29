import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import {
  LotteryEodReconciliationError,
  submitLotteryEodReconciliation,
} from "@/lib/lottery/eod-reconciliation";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const access = await requireScratchCardAccess(
      ["admin", "manager", "accountant", "cashier"],
      "/lottery/reconciliation",
    );

    if ("error" in access) {
      return access.error;
    }

    const body = await request.json();
    const periodLock = await requireOpenAccountingPeriod(
      access,
      body?.date,
      "Lottery EOD reconciliation",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await submitLotteryEodReconciliation(access, body);

    await appendAuditEvent({
      supabase: access.supabase,
      storeKey: access.activeStoreKey,
      entityType: "lottery_eod_reconciliation",
      entityId: result.reportDate,
      action: "lottery.eod_reconciled",
      summary: `Lottery EOD reconciled for ${result.reportDate}`,
      actorId: access.currentUser.id,
      actorName:
        access.currentUser.user_metadata?.full_name ??
        access.currentUser.email ??
        "User",
      actorRole: access.currentUserRole,
      metadata: {
        binsReconciled: result.binsReconciled,
        discrepancyStatus: result.discrepancyStatus,
        lotteryBondFee: result.lotteryBondFee,
        lotteryCashAdvanceNetImpact: result.lotteryCashAdvanceNetImpact,
        lotteryCashAdvancesTaken: result.lotteryCashAdvancesTaken,
        lotteryCashPaybacksReceived: result.lotteryCashPaybacksReceived,
        netShortOver: result.shortOverAmount,
        reportDate: result.reportDate,
        scratchSales: result.scratchSales,
        startingFloat: result.startingFloat,
        terminalSales: result.terminalSales,
        tillCash: result.tillCash,
        totalExpectedCash: result.totalExpectedCash,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LotteryEodReconciliationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    return scratchCardErrorResponse(
      error,
      "Failed to save lottery EOD reconciliation",
    );
  }
}
