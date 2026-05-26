import { NextRequest, NextResponse } from "next/server";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { runLotteryReconciliationEngine } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type EodReconciliationBody = {
  date?: unknown;
  managerNotes?: unknown;
  posRegisterTotal?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const access = await requireScratchCardAccess(
      ["admin", "manager", "accountant", "cashier"],
      "/lottery/reconciliation",
    );

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as EodReconciliationBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      body.date,
      "Lottery reconciliation",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await runLotteryReconciliationEngine(access, {
      date: body.date,
      managerNotes: body.managerNotes,
      posRegisterTotal: body.posRegisterTotal,
    });

    return NextResponse.json(result);
  } catch (error) {
    return scratchCardErrorResponse(error, "Failed to run EOD reconciliation");
  }
}
