import { NextRequest, NextResponse } from "next/server";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { markScratchPackSoldOut } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type SoldOutScratchPackBody = {
  binNumber?: unknown;
  date?: unknown;
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

    const body = (await request.json()) as SoldOutScratchPackBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      body.date,
      "Scratch pack sold out",
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
      "Failed to mark scratch pack sold out",
    );
  }
}
