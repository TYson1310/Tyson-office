import { NextRequest, NextResponse } from "next/server";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { receiveScratchPack } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type ReceiveScratchPackBody = {
  barcode?: unknown;
  receivedDate?: unknown;
  scannedBarcode?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const access = await requireScratchCardAccess(
      ["admin", "manager", "cashier", "employee"],
      "/scratch-cards/delivery-scan",
    );

    if ("error" in access) {
      return access.error;
    }

    const body = (await request.json()) as ReceiveScratchPackBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      body.receivedDate,
      "Scratch pack receipt",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await receiveScratchPack(
      access,
      body.barcode ?? body.scannedBarcode,
      {
        receivedDate: body.receivedDate,
      },
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return scratchCardErrorResponse(error, "Failed to receive scratch pack");
  }
}
