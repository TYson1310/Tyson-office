import { NextRequest, NextResponse } from "next/server";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { reconcileScratchBinShift } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type ReconcileScratchBinBody = {
  binNumber?: unknown;
  date?: unknown;
  endTicketNumber?: unknown;
  posSalesAmount?: unknown;
  startTicketNumber?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const access = await requireScratchCardAccess(
      ["admin", "manager", "cashier", "employee"],
      "/scratch-cards/audit",
    );

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as ReconcileScratchBinBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      body.date,
      "Scratch bin reconciliation",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await reconcileScratchBinShift(access, {
      binNumber: body.binNumber,
      date: body.date,
      endTicketNumber: body.endTicketNumber,
      posSalesAmount: body.posSalesAmount,
      startTicketNumber: body.startTicketNumber,
    });

    return NextResponse.json(result);
  } catch (error) {
    return scratchCardErrorResponse(error, "Failed to reconcile scratch bin");
  }
}
