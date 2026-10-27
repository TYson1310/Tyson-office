import { NextRequest, NextResponse } from "next/server";
import {
  requireScratchCardAccess,
  requireOpenAccountingPeriod,
  scratchCardErrorResponse,
} from "@/lib/scratch-cards/api";
import { loadScratchPackBin } from "@/lib/scratch-cards/workflows";

export const runtime = "nodejs";

type LoadScratchBinBody = {
  packId?: unknown;
  binNumber?: unknown;
  packNumber?: unknown;
  scannedBarcode?: unknown;
  retiredEndTicketNumber?: unknown;
  ticketDirection?: unknown;
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

    const body = (await request.json()) as LoadScratchBinBody;
    const periodLock = await requireOpenAccountingPeriod(
      access,
      null,
      "Scratch bin load",
    );

    if (periodLock) {
      return periodLock;
    }

    const result = await loadScratchPackBin(access, {
      binNumber: body.binNumber,
      packId: body.packId,
      packNumber: body.packNumber,
      scannedBarcode: body.scannedBarcode,
      retiredEndTicketNumber: body.retiredEndTicketNumber,
      ticketDirection: body.ticketDirection,
    });

    return NextResponse.json(result);
  } catch (error) {
    return scratchCardErrorResponse(
      error,
      "Failed to load scratch pack into bin",
    );
  }
}
