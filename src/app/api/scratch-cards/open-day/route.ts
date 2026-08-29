import { NextRequest, NextResponse } from "next/server";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { autoCarryForwardLotteryDay } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type OpenLotteryDayBody = {
  date?: unknown;
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

    const body = (await request.json()) as OpenLotteryDayBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      body.date,
      "Scratch day open",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await autoCarryForwardLotteryDay(access, {
      date: body.date,
    });

    return NextResponse.json(result);
  } catch (error) {
    return scratchCardErrorResponse(error, "Failed to open lottery day");
  }
}
