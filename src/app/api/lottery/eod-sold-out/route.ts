import { NextRequest, NextResponse } from "next/server";
import {
  requireOpenAccountingPeriod,
  requireScratchCardAccess,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { markScratchPackSoldOut } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type LotteryEodSoldOutBody = {
  binNumber?: unknown;
  date?: unknown;
  startTicketNumber?: unknown;
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

    const body = (await request.json()) as LotteryEodSoldOutBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      body.date,
      "Lottery EOD sold out pack",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await markScratchPackSoldOut(access, {
      binNumber: body.binNumber,
      date: body.date,
      startTicketNumber: body.startTicketNumber,
    });

    return NextResponse.json(result);
  } catch (error) {
    return scratchCardErrorResponse(
      error,
      "Failed to mark lottery EOD pack sold out",
    );
  }
}
