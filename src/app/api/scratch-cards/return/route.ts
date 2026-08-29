import { NextRequest, NextResponse } from "next/server";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { returnScratchPackToLottery } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type ReturnScratchPackBody = {
  binNumber?: unknown;
  inventoryId?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const access = await requireScratchCardAccess(
      ["admin", "manager"],
      "/scratch-cards/audit",
    );

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as ReturnScratchPackBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      null,
      "Scratch pack return",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await returnScratchPackToLottery(access, {
      binNumber: body.binNumber,
      inventoryId: body.inventoryId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return scratchCardErrorResponse(error, "Failed to return scratch pack");
  }
}
