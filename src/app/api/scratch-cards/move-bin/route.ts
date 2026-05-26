import { NextRequest, NextResponse } from "next/server";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { moveActiveScratchPackBin } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type MoveScratchBinBody = {
  sourceBinNumber?: unknown;
  targetBinNumber?: unknown;
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

    const body = (await request.json()) as MoveScratchBinBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      null,
      "Scratch bin move",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await moveActiveScratchPackBin(access, {
      sourceBinNumber: body.sourceBinNumber,
      targetBinNumber: body.targetBinNumber,
    });

    return NextResponse.json(result);
  } catch (error) {
    return scratchCardErrorResponse(error, "Failed to move scratch pack bin");
  }
}
