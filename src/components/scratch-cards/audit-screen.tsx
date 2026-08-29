"use client";

import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import {
  Archive,
  CameraOff,
  CheckCircle2,
  CircleDollarSign,
  History,
  LoaderCircle,
  Package,
  PackagePlus,
  RotateCcw,
  ScanLine,
  Ticket,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { cn } from "@/lib/utils";
import type {
  ScratchAuditBin,
  ScratchBackstockPack,
  ScratchPackDetail,
} from "@/lib/scratch-cards/data";

type ScratchCardBinManagerProps = {
  backstockPacks: ScratchBackstockPack[];
  bins: ScratchAuditBin[];
  binCount: number;
  source: "database" | "unconfigured" | "error";
  errorMessage?: string;
};

type ActionState = {
  key: string | null;
  type: "load" | "move" | "return" | "soldOut" | null;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const MIN_SCRATCH_BARCODE_DIGITS = 14;
const LOTTERY_ITF_ALLOWED_LENGTHS = [14, 16, 18, 20, 22, 24, 26, 28, 30];
const NATIVE_BARCODE_FORMATS = ["itf"];
const RECENT_LOAD_SCAN_COOLDOWN_MS = 2500;
const SCANNER_FORMATS = [BarcodeFormat.ITF];

type ScannedLoadBarcode = {
  barcode: string;
  displayBarcode: string;
  gameId: string;
  itemNumber: string | null;
  packNumber: string;
  ticketNumber: string;
};

type NativeBarcodeDetection = {
  format?: string;
  rawValue: string;
};

type NativeBarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<NativeBarcodeDetection[]>;
};

type NativeBarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): NativeBarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

type ExtendedMediaTrackCapabilities = MediaTrackCapabilities & {
  exposureMode?: string[];
  focusMode?: string[];
  whiteBalanceMode?: string[];
};

type ExtendedMediaTrackConstraintSet = MediaTrackConstraintSet & {
  exposureMode?: string;
  focusMode?: string;
  whiteBalanceMode?: string;
};

type PackValueSource = {
  gameTicketCount: number | null;
  packTicketCount: number | null;
  ticketPrice: number;
};

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return dateTimeFormatter.format(date);
}

function formatStatus(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Unknown";
}

function getInsecureCameraMessage() {
  if (typeof window === "undefined" || window.isSecureContext) {
    return "";
  }

  return "Camera is blocked on this HTTP network address. Open the HTTPS URL on this device.";
}

function getCameraErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return error instanceof Error
      ? error.message
      : "Camera could not be started.";
  }

  if (error.name === "NotAllowedError") {
    return "Camera permission was blocked.";
  }

  if (error.name === "NotFoundError") {
    return "No camera was found on this device.";
  }

  if (error.name === "NotReadableError") {
    return "Camera is already in use by another app or browser tab.";
  }

  return error.message || "Camera could not be started.";
}

function parseScannedLoadBarcode(value: string): ScannedLoadBarcode | null {
  const digitsOnly = value.replace(/\D/g, "");

  if (digitsOnly.length < MIN_SCRATCH_BARCODE_DIGITS) {
    return null;
  }

  const gameId = digitsOnly.slice(0, 5);
  const packNumber = digitsOnly.slice(5, 11);
  const ticketNumber = digitsOnly.slice(11, 14);
  const itemNumber = digitsOnly.slice(14) || null;
  const barcode = `${gameId}-${packNumber}-${ticketNumber}`;

  return {
    barcode,
    displayBarcode: itemNumber ? `${barcode}-${itemNumber}` : barcode,
    gameId,
    itemNumber,
    packNumber,
    ticketNumber,
  };
}

function getCameraVideoTrack(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;

  if (!(stream instanceof MediaStream)) {
    return null;
  }

  return stream.getVideoTracks()[0] ?? null;
}

async function applyMobileCameraTuning(video: HTMLVideoElement | null) {
  const track = getCameraVideoTrack(video);

  if (!track?.applyConstraints) {
    return false;
  }

  const capabilities =
    typeof track.getCapabilities === "function"
      ? (track.getCapabilities() as ExtendedMediaTrackCapabilities)
      : {};
  const advanced: ExtendedMediaTrackConstraintSet[] = [];

  if (capabilities.focusMode?.includes("continuous")) {
    advanced.push({ focusMode: "continuous" });
  }

  if (capabilities.exposureMode?.includes("continuous")) {
    advanced.push({ exposureMode: "continuous" });
  }

  if (capabilities.whiteBalanceMode?.includes("continuous")) {
    advanced.push({ whiteBalanceMode: "continuous" });
  }

  if (advanced.length === 0) {
    return false;
  }

  try {
    await track.applyConstraints({ advanced } as MediaTrackConstraints);
    return true;
  } catch {
    return false;
  }
}

function getPackValueTicketCount(pack: PackValueSource | null) {
  return pack?.gameTicketCount ?? null;
}

function getPackValue(pack: PackValueSource | null) {
  const ticketCount = getPackValueTicketCount(pack);

  if (!pack || !ticketCount) {
    return null;
  }

  return ticketCount * pack.ticketPrice;
}

function getPackTicketCount(bin: ScratchAuditBin) {
  return getPackValueTicketCount(bin.currentPack);
}

function getFinalTicketNumber(bin: ScratchAuditBin) {
  const ticketCount = getPackTicketCount(bin);

  if (!ticketCount || ticketCount > 1000) {
    return null;
  }

  return String(ticketCount - 1).padStart(3, "0");
}

function isSoldOut(bin: ScratchAuditBin) {
  const finalTicketNumber = getFinalTicketNumber(bin);

  if (!bin.inventoryId || !finalTicketNumber) {
    return false;
  }

  return Number(bin.lastTicketNumber) >= Number(finalTicketNumber);
}

function getBinStatus(bin: ScratchAuditBin) {
  if (!bin.inventoryId) {
    return {
      label: "Empty",
      tone: "slate" as const,
    };
  }

  if (isSoldOut(bin)) {
    return {
      label: "Sold out",
      tone: "amber" as const,
    };
  }

  return {
    label: "Active",
    tone: "green" as const,
  };
}

function getTicketProgress(bin: ScratchAuditBin) {
  const ticketCount = getPackTicketCount(bin);

  if (!bin.inventoryId || !ticketCount) {
    return null;
  }

  if (isSoldOut(bin)) {
    return 100;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((Number(bin.lastTicketNumber) / ticketCount) * 100)),
  );
}

function getRemainingTicketCount(bin: ScratchAuditBin) {
  return getRemainingTicketCountFromStart(bin, bin.lastTicketNumber);
}

function normalizeTicketInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 3);
}

function padTicketInput(value: string) {
  const normalized = normalizeTicketInput(value);

  if (!normalized) {
    return null;
  }

  return String(Number(normalized)).padStart(3, "0");
}

function getRemainingTicketCountFromStart(
  bin: ScratchAuditBin,
  startTicketNumber: string | null,
) {
  const ticketCount = getPackTicketCount(bin);

  if (!bin.inventoryId || !ticketCount || !startTicketNumber) {
    return null;
  }

  const startTicketValue = Number(startTicketNumber);

  if (
    !Number.isFinite(startTicketValue) ||
    startTicketValue >= ticketCount - 1
  ) {
    return 0;
  }

  return Math.max(0, ticketCount - startTicketValue);
}

function getRemainingTicketValue(bin: ScratchAuditBin) {
  const remainingTickets = getRemainingTicketCount(bin);

  if (remainingTickets === null) {
    return null;
  }

  return remainingTickets * bin.ticketPrice;
}

function getRemainingTicketValueFromStart(
  bin: ScratchAuditBin,
  startTicketNumber: string | null,
) {
  const remainingTickets = getRemainingTicketCountFromStart(
    bin,
    startTicketNumber,
  );

  if (remainingTickets === null) {
    return null;
  }

  return remainingTickets * bin.ticketPrice;
}

function getBinPackValue(bin: ScratchAuditBin) {
  const ticketCount = getPackTicketCount(bin);

  if (!bin.inventoryId || !ticketCount) {
    return 0;
  }

  return ticketCount * bin.ticketPrice;
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-sm font-semibold text-slate-950 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value ?? "Not recorded"}
      </div>
    </div>
  );
}

function PackDetailPanel({
  emptyMessage,
  icon,
  pack,
  title,
}: {
  emptyMessage: string;
  icon: ReactNode;
  pack: ScratchPackDetail | null;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      </div>

      {pack ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <DetailItem label="Pack number" value={pack.packNumber} mono />
          <DetailItem label="Pack ID" value={pack.packId} mono />
          <DetailItem label="Game" value={pack.gameName} />
          <DetailItem label="Game ID" value={`#${pack.gameId}`} mono />
          <DetailItem label="Status" value={formatStatus(pack.status)} />
          <DetailItem
            label="Ticket price"
            value={formatCurrency(pack.ticketPrice)}
          />
          <DetailItem
            label="Pack value"
            value={
              getPackValue(pack) === null
                ? null
                : formatCurrency(getPackValue(pack) ?? 0)
            }
          />
          <DetailItem
            label="Received ticket"
            value={pack.receivedTicketNumber}
            mono
          />
          <DetailItem label="Control code" value={pack.packControlCode} mono />
          <DetailItem
            label="Pack tickets"
            value={getPackValueTicketCount(pack)}
          />
          <DetailItem
            label="Date received"
            value={formatDateTime(pack.dateReceived)}
          />
          <DetailItem
            label="Date activated"
            value={formatDateTime(pack.dateActivated)}
          />
          <DetailItem
            label="Last recorded end"
            value={pack.endTicketNumber}
            mono
          />
          <DetailItem label="Tickets sold" value={pack.ticketsSold} />
          <DetailItem
            label="Sales"
            value={
              pack.calculatedRevenue === null
                ? null
                : formatCurrency(pack.calculatedRevenue)
            }
          />
          <DetailItem label="Audit time" value={formatDateTime(pack.auditAt)} />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm font-medium text-slate-500">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

export function ScratchCardBinManager({
  backstockPacks,
  bins,
  binCount,
  errorMessage,
  source,
}: ScratchCardBinManagerProps) {
  const router = useRouter();
  const { error: notifyError, success } = useAppNotifications();
  const loadScannerControlsRef = useRef<IScannerControls | null>(null);
  const loadScannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const nativeLoadDetectorRef = useRef<NativeBarcodeDetectorInstance | null>(
    null,
  );
  const nativeLoadDetectorTimerRef = useRef<number | null>(null);
  const nativeLoadDetectorBusyRef = useRef(false);
  const recentLoadScanRef = useRef<{
    barcode: string;
    scannedAt: number;
  } | null>(null);
  const [backstockItems, setBackstockItems] = useState(backstockPacks);
  const [selectedBinNumber, setSelectedBinNumber] = useState<number | null>(
    null,
  );
  const [manualPackId, setManualPackId] = useState("");
  const [moveTargetBinNumber, setMoveTargetBinNumber] = useState("");
  const [scannedPackBarcode, setScannedPackBarcode] = useState("");
  const [soldOutStartTicketNumber, setSoldOutStartTicketNumber] = useState("");
  const [loadScannerMessage, setLoadScannerMessage] =
    useState("Start scanner.");
  const [loadScannerState, setLoadScannerState] = useState<
    "active" | "error" | "idle" | "starting" | "unsupported"
  >("idle");
  const [actionState, setActionState] = useState<ActionState>({
    key: null,
    type: null,
  });
  const [scanMode, setScanMode] = useState(false);

  const selectedBin = useMemo(
    () => bins.find((bin) => bin.binNumber === selectedBinNumber) ?? null,
    [bins, selectedBinNumber],
  );
  const selectedBinInventoryId = selectedBin?.inventoryId ?? null;
  const selectedBinLastTicketNumber = selectedBin?.lastTicketNumber ?? "";
  const normalizedSoldOutStartTicketNumber = padTicketInput(
    soldOutStartTicketNumber,
  );
  const soldOutRemainingValue =
    selectedBin && normalizedSoldOutStartTicketNumber
      ? getRemainingTicketValueFromStart(
          selectedBin,
          normalizedSoldOutStartTicketNumber,
        )
      : null;
  const scannedPack = useMemo(
    () => parseScannedLoadBarcode(scannedPackBarcode),
    [scannedPackBarcode],
  );
  const manualBackstockPack = useMemo(
    () => backstockItems.find((pack) => pack.id === manualPackId) ?? null,
    [backstockItems, manualPackId],
  );
  const scannedBackstockPack = useMemo(
    () =>
      scannedPack
        ? (backstockItems.find(
            (pack) =>
              pack.packId === scannedPack.barcode ||
              (pack.gameId === scannedPack.gameId &&
                pack.packNumber === scannedPack.packNumber),
          ) ?? null)
        : null,
    [backstockItems, scannedPack],
  );
  const selectedMoveTargetBinNumber = Number(moveTargetBinNumber);
  const moveTargetBin = useMemo(
    () =>
      Number.isInteger(selectedMoveTargetBinNumber)
        ? (bins.find((bin) => bin.binNumber === selectedMoveTargetBinNumber) ??
          null)
        : null,
    [bins, selectedMoveTargetBinNumber],
  );

  useEffect(() => {
    setSoldOutStartTicketNumber(selectedBinLastTicketNumber);
  }, [selectedBinInventoryId, selectedBinLastTicketNumber]);

  const activeBinCount = bins.filter((bin) => bin.inventoryId).length;
  const soldOutCount = bins.filter((bin) => isSoldOut(bin)).length;
  const openBinCount = Math.max(binCount - activeBinCount, 0);
  const activeBinValue = bins.reduce(
    (sum, bin) => sum + getBinPackValue(bin),
    0,
  );
  const occupancyPercent =
    binCount > 0 ? Math.round((activeBinCount / binCount) * 100) : 0;
  const scanModeBins = useMemo(
    () =>
      bins
        .slice()
        .sort((left, right) => {
          const leftPriority = isSoldOut(left)
            ? 0
            : left.inventoryId
              ? 1
              : 2;
          const rightPriority = isSoldOut(right)
            ? 0
            : right.inventoryId
              ? 1
              : 2;

          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
          }

          return left.binNumber - right.binNumber;
        }),
    [bins],
  );

  const receiveLoadScannerBarcode = useCallback((rawBarcode: string) => {
    const parsed = parseScannedLoadBarcode(rawBarcode);

    if (!parsed) {
      setLoadScannerMessage("Barcode not recognized. Use the long barcode.");
      return;
    }

    const now = Date.now();
    const recentScan = recentLoadScanRef.current;

    if (
      recentScan?.barcode === parsed.barcode &&
      now - recentScan.scannedAt < RECENT_LOAD_SCAN_COOLDOWN_MS
    ) {
      return;
    }

    recentLoadScanRef.current = {
      barcode: parsed.barcode,
      scannedAt: now,
    };
    setManualPackId("");
    setScannedPackBarcode(rawBarcode);
    setLoadScannerMessage(`Scanned pack ${parsed.packNumber}. Ready to load.`);
  }, []);

  const stopNativeLoadDetector = useCallback(() => {
    if (nativeLoadDetectorTimerRef.current !== null) {
      window.clearTimeout(nativeLoadDetectorTimerRef.current);
      nativeLoadDetectorTimerRef.current = null;
    }

    nativeLoadDetectorRef.current = null;
    nativeLoadDetectorBusyRef.current = false;
  }, []);

  const startNativeLoadDetector = useCallback(async () => {
    const Detector = (
      window as typeof window & {
        BarcodeDetector?: NativeBarcodeDetectorConstructor;
      }
    ).BarcodeDetector;

    if (!Detector) {
      return false;
    }

    let formats = NATIVE_BARCODE_FORMATS;

    if (Detector.getSupportedFormats) {
      const supportedFormats = await Detector.getSupportedFormats();
      formats = NATIVE_BARCODE_FORMATS.filter((format) =>
        supportedFormats.includes(format),
      );

      if (formats.length === 0) {
        return false;
      }
    }

    nativeLoadDetectorRef.current = new Detector({ formats });

    const scanVideo = async () => {
      const detector = nativeLoadDetectorRef.current;
      const video = loadScannerVideoRef.current;

      if (!detector || !video) {
        return;
      }

      if (video.readyState >= 2 && !nativeLoadDetectorBusyRef.current) {
        nativeLoadDetectorBusyRef.current = true;

        try {
          const detections = await detector.detect(video);
          const detection = detections.find((item) => item.rawValue);

          if (detection?.rawValue) {
            receiveLoadScannerBarcode(detection.rawValue);
          }
        } catch {
          stopNativeLoadDetector();
          return;
        } finally {
          nativeLoadDetectorBusyRef.current = false;
        }
      }

      nativeLoadDetectorTimerRef.current = window.setTimeout(scanVideo, 180);
    };

    nativeLoadDetectorTimerRef.current = window.setTimeout(scanVideo, 180);
    return true;
  }, [receiveLoadScannerBarcode, stopNativeLoadDetector]);

  const stopLoadScanner = useCallback(() => {
    stopNativeLoadDetector();
    loadScannerControlsRef.current?.stop();
    loadScannerControlsRef.current = null;

    if (loadScannerVideoRef.current) {
      loadScannerVideoRef.current.srcObject = null;
    }

    setLoadScannerState("idle");
    setLoadScannerMessage("Scanner stopped.");
  }, [stopNativeLoadDetector]);

  const startLoadScanner = useCallback(async () => {
    const insecureCameraMessage = getInsecureCameraMessage();

    if (insecureCameraMessage) {
      setLoadScannerState("unsupported");
      setLoadScannerMessage(insecureCameraMessage);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setLoadScannerState("unsupported");
      setLoadScannerMessage("Camera access is not available in this browser.");
      return;
    }

    setLoadScannerState("starting");
    setLoadScannerMessage("Starting scanner.");

    try {
      const video = loadScannerVideoRef.current;

      if (!video) {
        throw new Error("Scanner preview is not ready.");
      }

      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.ALLOWED_LENGTHS, LOTTERY_ITF_ALLOWED_LENGTHS);
      hints.set(DecodeHintType.POSSIBLE_FORMATS, SCANNER_FORMATS);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess: RECENT_LOAD_SCAN_COOLDOWN_MS,
        tryPlayVideoTimeout: 8000,
      });
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            aspectRatio: { ideal: 1.7777777778 },
            facingMode: { ideal: "environment" },
            height: { ideal: 1080 },
            width: { ideal: 1920 },
          },
        },
        video,
        (result) => {
          const barcode = result?.getText();

          if (barcode) {
            receiveLoadScannerBarcode(barcode);
          }
        },
      );

      loadScannerControlsRef.current = controls;
      const nativeDetectorStarted = await startNativeLoadDetector();
      const cameraTuned = await applyMobileCameraTuning(video);

      setLoadScannerMessage(
        nativeDetectorStarted
          ? "Android scanner is on. Hold the long barcode in frame."
          : cameraTuned
            ? "Camera focus is on. Hold the long barcode in frame."
            : "Scanner active. Hold the long barcode in frame.",
      );
      setLoadScannerState("active");
    } catch (error) {
      setLoadScannerState("error");
      setLoadScannerMessage(getCameraErrorMessage(error));
    }
  }, [receiveLoadScannerBarcode, startNativeLoadDetector]);

  useEffect(() => {
    setBackstockItems(backstockPacks);
  }, [backstockPacks]);

  useEffect(() => {
    if (selectedBinNumber === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedBinNumber(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedBinNumber]);

  function openBin(binNumber: number) {
    setSelectedBinNumber(binNumber);
    setManualPackId("");
    setMoveTargetBinNumber("");
    setScannedPackBarcode("");
    setLoadScannerState("idle");
    setLoadScannerMessage("Start scanner.");
    recentLoadScanRef.current = null;
  }

  async function loadScannedPackToBin() {
    if (!selectedBin) {
      notifyError("Select a bin before loading a pack.");
      return;
    }

    const packBarcode = parseScannedLoadBarcode(scannedPackBarcode);

    if (!packBarcode) {
      notifyError("Scan the long lottery barcode before loading the bin.");
      return;
    }

    if (selectedBin.inventoryId) {
      notifyError(
        "Mark the current pack sold out before loading a replacement.",
      );
      return;
    }

    setActionState({ key: packBarcode.barcode, type: "load" });

    try {
      const response = await fetch("/api/scratch-cards/load-bin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          binNumber: selectedBin.binNumber,
          packNumber: packBarcode.packNumber,
          scannedBarcode: scannedPackBarcode,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load pack into bin");
      }

      setBackstockItems((current) =>
        current.filter(
          (pack) =>
            !(
              pack.gameId === packBarcode.gameId &&
              pack.packNumber === packBarcode.packNumber
            ),
        ),
      );
      setSelectedBinNumber(null);
      setManualPackId("");
      setMoveTargetBinNumber("");
      setScannedPackBarcode("");
      success(
        `Loaded pack ${packBarcode.packNumber} to bin ${selectedBin.binNumber}.`,
      );
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : "Failed to load pack into bin",
      );
    } finally {
      setActionState({ key: null, type: null });
    }
  }

  async function loadManualPackToBin() {
    if (!selectedBin) {
      notifyError("Select a bin before loading a pack.");
      return;
    }

    if (!manualBackstockPack) {
      notifyError("Choose a backstock pack before loading the bin.");
      return;
    }

    if (selectedBin.inventoryId) {
      notifyError(
        "Mark the current pack sold out before loading a replacement.",
      );
      return;
    }

    setActionState({ key: manualBackstockPack.id, type: "load" });

    try {
      const response = await fetch("/api/scratch-cards/load-bin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          binNumber: selectedBin.binNumber,
          packId: manualBackstockPack.id,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load pack into bin");
      }

      setBackstockItems((current) =>
        current.filter((pack) => pack.id !== manualBackstockPack.id),
      );
      setSelectedBinNumber(null);
      setManualPackId("");
      setMoveTargetBinNumber("");
      setScannedPackBarcode("");
      success(
        `Loaded pack ${manualBackstockPack.packNumber} to bin ${selectedBin.binNumber}.`,
      );
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : "Failed to load pack into bin",
      );
    } finally {
      setActionState({ key: null, type: null });
    }
  }

  async function moveCurrentPackBin() {
    if (!selectedBin?.inventoryId) {
      notifyError("No active pack is loaded in this bin.");
      return;
    }

    if (!moveTargetBin) {
      notifyError("Choose a destination bin.");
      return;
    }

    setActionState({ key: selectedBin.inventoryId, type: "move" });

    try {
      const response = await fetch("/api/scratch-cards/move-bin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceBinNumber: selectedBin.binNumber,
          targetBinNumber: moveTargetBin.binNumber,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        mode?: "moved" | "swapped";
        targetBinNumber?: number;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to move scratch pack");
      }

      setSelectedBinNumber(null);
      setMoveTargetBinNumber("");
      success(
        payload.mode === "swapped"
          ? `Swapped bins ${selectedBin.binNumber} and ${moveTargetBin.binNumber}.`
          : `Moved pack ${selectedBin.packNumber ?? ""} to bin ${
              payload.targetBinNumber ?? moveTargetBin.binNumber
            }.`,
      );
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : "Failed to move scratch pack",
      );
    } finally {
      setActionState({ key: null, type: null });
    }
  }

  async function markCurrentPackSoldOut() {
    if (!selectedBin?.inventoryId) {
      notifyError("No active pack is loaded in this bin.");
      return;
    }

    const finalTicketNumber = getFinalTicketNumber(selectedBin);

    if (!finalTicketNumber) {
      notifyError("Current pack is missing a valid pack ticket count.");
      return;
    }

    if (!normalizedSoldOutStartTicketNumber) {
      notifyError("Enter a valid start ticket number.");
      return;
    }

    if (
      Number(normalizedSoldOutStartTicketNumber) > Number(finalTicketNumber)
    ) {
      notifyError(
        "Start ticket number cannot be higher than the final ticket.",
      );
      return;
    }

    const remainingValue = soldOutRemainingValue ?? 0;
    const confirmed = window.confirm(
      `Mark pack ${selectedBin.packNumber ?? ""} sold out from ticket ${normalizedSoldOutStartTicketNumber} to ${finalTicketNumber}? This records ${formatCurrency(
        remainingValue,
      )} in scratch sales.`,
    );

    if (!confirmed) {
      return;
    }

    setActionState({ key: selectedBin.inventoryId, type: "soldOut" });

    try {
      const response = await fetch("/api/scratch-cards/sold-out", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          binNumber: selectedBin.binNumber,
          startTicketNumber: normalizedSoldOutStartTicketNumber,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to mark pack sold out");
      }

      setSelectedBinNumber(null);
      setMoveTargetBinNumber("");
      setScannedPackBarcode("");
      success(
        `Marked pack ${
          payload.packNumber ?? selectedBin.packNumber
        } sold out at ticket ${payload.endTicketNumber ?? finalTicketNumber}.`,
      );
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : "Failed to mark pack sold out",
      );
    } finally {
      setActionState({ key: null, type: null });
    }
  }

  async function returnCurrentPack() {
    if (!selectedBin?.inventoryId) {
      notifyError("No active pack is loaded in this bin.");
      return;
    }

    const confirmed = window.confirm(
      `Return pack ${selectedBin.packNumber ?? ""} to the lottery?`,
    );

    if (!confirmed) {
      return;
    }

    setActionState({ key: selectedBin.inventoryId, type: "return" });

    try {
      const response = await fetch("/api/scratch-cards/return", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          binNumber: selectedBin.binNumber,
          inventoryId: selectedBin.inventoryId,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to return scratch pack");
      }

      setSelectedBinNumber(null);
      setMoveTargetBinNumber("");
      setScannedPackBarcode("");
      success(
        `Returned pack ${payload.packNumber ?? selectedBin.packNumber} for ${formatCurrency(
          Number(payload.returnedValue ?? 0),
        )}.`,
      );
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : "Failed to return scratch pack",
      );
    } finally {
      setActionState({ key: null, type: null });
    }
  }

  useEffect(() => {
    if (selectedBinNumber !== null) {
      return;
    }

    stopLoadScanner();
  }, [selectedBinNumber, stopLoadScanner]);

  useEffect(() => stopLoadScanner, [stopLoadScanner]);

  return (
    <div className="space-y-6">
      {source !== "database" ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          {source === "unconfigured"
            ? "Supabase is not configured. Configure the database before managing scratch card bins."
            : errorMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Allocated"
          value={binCount}
          detail={`${occupancyPercent}% occupied`}
          tone="slate"
          icon={<Archive className="h-5 w-5" />}
        />
        <StatCard
          label="Active packs"
          value={activeBinCount}
          detail={`${openBinCount} open bins`}
          tone="blue"
          icon={<Package className="h-5 w-5" />}
        />
        <StatCard
          label="Sold out"
          value={soldOutCount}
          detail="Ready for replacement"
          tone="amber"
          icon={<Ticket className="h-5 w-5" />}
        />
        <StatCard
          label="Pack value"
          value={formatCurrency(activeBinValue)}
          detail={`${backstockItems.length} backstock packs`}
          tone="green"
          icon={<CircleDollarSign className="h-5 w-5" />}
        />
      </div>

      <SectionCard
        title="Scratch card bins"
        description={
          scanMode
            ? "Phone-first controls with larger cards and only the fields needed while scanning packs."
            : "Review active games, swap bins, and return discontinued games."
        }
        action={
          <button
            type="button"
            onClick={() => setScanMode((current) => !current)}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition",
              scanMode
                ? "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                : "bg-slate-950 text-white hover:bg-slate-800",
            )}
          >
            <ScanLine className="h-4 w-4" />
            {scanMode ? "Exit scan mode" : "Mobile scan mode"}
          </button>
        }
        className="rounded-lg sm:rounded-lg"
        headerClassName="px-4 py-3 sm:px-4"
      >
        {scanMode ? (
          <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">
            Sold-out bins appear first. Tap a card to open the same bin manager
            with scanner, load, sold-out, move, and return actions.
          </div>
        ) : null}

        <div
          className={cn(
            "grid gap-4",
            scanMode
              ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
              : "grid-cols-[repeat(auto-fill,minmax(176px,1fr))]",
          )}
        >
          {(scanMode ? scanModeBins : bins).map((bin) => {
            const isActive = Boolean(bin.inventoryId);
            const status = getBinStatus(bin);

            return (
              <button
                type="button"
                key={bin.binNumber}
                onClick={() => openBin(bin.binNumber)}
                className={cn(
                  "group relative flex min-w-0 flex-col overflow-hidden rounded-lg border text-left transition hover:border-primary/40 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2",
                  scanMode ? "min-h-[230px]" : "min-h-[190px]",
                  isActive
                    ? "border-slate-200 bg-white"
                    : "border-dashed border-slate-200 bg-white",
                )}
              >
                {isActive ? (
                  <>
                    <div className="relative h-28 shrink-0 overflow-hidden bg-slate-100">
                      {bin.gameImageUrl ? (
                        // Supabase Storage URLs are tenant-specific, so keep this as a browser image.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={bin.gameImageUrl}
                          alt={bin.gameName ?? "Scratch card game"}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-slate-100 px-3 text-center text-[10px] font-semibold uppercase text-slate-500">
                          No image
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/55 to-transparent" />
                      <div className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-950 shadow-sm ring-1 ring-white/80">
                        Bin {String(bin.binNumber).padStart(2, "0")}
                      </div>
                      <div className="absolute right-2.5 top-2.5">
                        <StatusBadge
                          tone={status.tone}
                          className="bg-white/95 shadow-sm"
                        >
                          {status.label}
                        </StatusBadge>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col p-3">
                      <div className="truncate text-sm font-semibold text-slate-950">
                        {bin.gameName ?? "Unknown game"}
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate font-mono">
                          #{bin.gameId}
                        </span>
                        <span className="shrink-0 font-semibold text-slate-700">
                          {formatCurrency(bin.ticketPrice)}
                        </span>
                      </div>

                      {scanMode ? (
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] font-bold uppercase text-slate-500">
                              Pack
                            </div>
                            <div className="mt-1 truncate font-mono font-semibold text-slate-950">
                              {bin.packNumber ?? "-"}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] font-bold uppercase text-slate-500">
                              Last ticket
                            </div>
                            <div className="mt-1 font-mono font-semibold text-slate-950">
                              {bin.lastTicketNumber || "-"}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-auto pt-4 text-[11px] font-semibold text-slate-700">
                        {scanMode ? "Open scan controls" : "Manage"}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-4 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                      <Archive className="h-5 w-5" />
                    </div>
                    <div className="mt-4 text-[11px] font-semibold uppercase text-slate-500">
                      Bin {String(bin.binNumber).padStart(2, "0")}
                    </div>
                    <div className="mt-2">
                      <StatusBadge tone="slate">Open slot</StatusBadge>
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-800">
                      Ready for backstock
                    </div>
                    <div className="mt-1 text-xs font-medium text-slate-500">
                      {scanMode ? "Tap to scan or select pack" : "Load pack"}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </SectionCard>

      {selectedBin ? (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedBinNumber(null);
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="scratch-bin-manager-title"
              className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">
                    Scratch card bin
                  </div>
                  <h2
                    id="scratch-bin-manager-title"
                    className="mt-1 text-xl font-semibold text-slate-950"
                  >
                    Bin {String(selectedBin.binNumber).padStart(2, "0")}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBinNumber(null)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  aria-label="Close bin manager"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
                <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-4">
                    {selectedBin.inventoryId ? (
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <div className="relative h-44 bg-slate-100 sm:h-56">
                          {selectedBin.gameImageUrl ? (
                            // Supabase Storage URLs are tenant-specific, so keep this as a browser image.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={selectedBin.gameImageUrl}
                              alt={selectedBin.gameName ?? "Scratch card game"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500">
                              No game image
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/65 to-transparent" />
                        </div>
                        <div className="bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate text-lg font-semibold text-slate-950">
                                {selectedBin.gameName ?? "Unknown game"}
                              </h3>
                              <div className="mt-1 font-mono text-xs text-slate-500">
                                #{selectedBin.gameId} / {selectedBin.packNumber}
                              </div>
                            </div>
                            <StatusBadge tone={getBinStatus(selectedBin).tone}>
                              {getBinStatus(selectedBin).label}
                            </StatusBadge>
                          </div>
                          <div className="mt-4 grid gap-2 sm:grid-cols-3">
                            <DetailItem
                              label="Ticket"
                              value={formatCurrency(selectedBin.ticketPrice)}
                            />
                            <DetailItem
                              label="Last end"
                              value={selectedBin.lastTicketNumber}
                              mono
                            />
                            <DetailItem
                              label="Progress"
                              value={`${getTicketProgress(selectedBin) ?? 0}%`}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-12 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                          <Archive className="h-6 w-6" />
                        </div>
                        <h3 className="mt-4 text-base font-semibold text-slate-950">
                          Empty bin
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          Load a backstock pack into this bin.
                        </p>
                      </div>
                    )}

                    {selectedBin.inventoryId ? (
                      <section className="rounded-lg border border-amber-200 bg-white p-4">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100">
                            <CheckCircle2 className="h-4 w-4" />
                          </span>
                          <h3 className="text-sm font-semibold text-amber-950">
                            Mark pack sold out
                          </h3>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          <label className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                            <span className="block text-[10px] font-semibold uppercase text-slate-500">
                              Start ticket
                            </span>
                            <input
                              value={soldOutStartTicketNumber}
                              disabled={isSoldOut(selectedBin)}
                              onBlur={() =>
                                setSoldOutStartTicketNumber(
                                  normalizedSoldOutStartTicketNumber ?? "",
                                )
                              }
                              onChange={(event) =>
                                setSoldOutStartTicketNumber(
                                  normalizeTicketInput(event.target.value),
                                )
                              }
                              inputMode="numeric"
                              maxLength={3}
                              className="mt-1 w-full bg-transparent font-mono text-sm font-semibold text-slate-950 outline-none disabled:text-slate-500"
                            />
                          </label>
                          <DetailItem
                            label="Final ticket"
                            value={getFinalTicketNumber(selectedBin)}
                            mono
                          />
                          <DetailItem
                            label="Remaining sales"
                            value={formatCurrency(soldOutRemainingValue ?? 0)}
                          />
                        </div>
                        {isSoldOut(selectedBin) ? (
                          <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                            Final ticket is already recorded. This will move the
                            pack to the sold-out ledger without adding duplicate
                            scratch sales.
                          </div>
                        ) : null}
                        <button
                          type="button"
                          disabled={
                            source !== "database" ||
                            actionState.type === "soldOut" ||
                            !getFinalTicketNumber(selectedBin) ||
                            !normalizedSoldOutStartTicketNumber ||
                            Number(normalizedSoldOutStartTicketNumber) >
                              Number(getFinalTicketNumber(selectedBin))
                          }
                          onClick={() => void markCurrentPackSoldOut()}
                          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionState.type === "soldOut" ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          Mark sold out
                        </button>
                      </section>
                    ) : null}

                    {selectedBin.inventoryId ? (
                      <section className="rounded-lg border border-slate-200 bg-white p-4">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100">
                            <Package className="h-4 w-4" />
                          </span>
                          <h3 className="text-sm font-semibold text-slate-950">
                            Move active pack
                          </h3>
                        </div>

                        <div className="mt-4 space-y-3">
                          <select
                            value={moveTargetBinNumber}
                            onChange={(event) =>
                              setMoveTargetBinNumber(event.target.value)
                            }
                            className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
                          >
                            <option value="">Choose destination bin</option>
                            {bins
                              .filter(
                                (bin) =>
                                  bin.binNumber !== selectedBin.binNumber,
                              )
                              .map((bin) => (
                                <option
                                  key={bin.binNumber}
                                  value={bin.binNumber}
                                >
                                  Bin {String(bin.binNumber).padStart(2, "0")}{" "}
                                  {bin.inventoryId
                                    ? `- ${bin.gameName ?? "Active pack"} / ${bin.packNumber ?? ""}`
                                    : "- Empty"}
                                </option>
                              ))}
                          </select>

                          {moveTargetBin ? (
                            <div
                              className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${
                                moveTargetBin.inventoryId
                                  ? "border-amber-200/80 bg-amber-50 text-amber-900"
                                  : "border-sky-200/80 bg-sky-50 text-sky-900"
                              }`}
                            >
                              {moveTargetBin.inventoryId
                                ? `This swaps bin ${selectedBin.binNumber} with bin ${moveTargetBin.binNumber}. Both packs stay active.`
                                : `This moves the current pack to bin ${moveTargetBin.binNumber}. Status stays active.`}
                            </div>
                          ) : null}

                          <button
                            type="button"
                            disabled={
                              source !== "database" ||
                              !moveTargetBin ||
                              actionState.type === "move"
                            }
                            onClick={() => void moveCurrentPackBin()}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionState.type === "move" ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Package className="h-4 w-4" />
                            )}
                            {moveTargetBin?.inventoryId
                              ? "Swap bin positions"
                              : "Move to bin"}
                          </button>
                        </div>
                      </section>
                    ) : null}

                    <section className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100">
                          <PackagePlus className="h-4 w-4" />
                        </span>
                        <h3 className="text-sm font-semibold text-slate-950">
                          Load pack to bin
                        </h3>
                      </div>

                      <div className="mt-4 space-y-3">
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
                          <div className="relative h-[140px] bg-slate-950 sm:h-[175px]">
                            <video
                              ref={loadScannerVideoRef}
                              muted
                              playsInline
                              className="block h-full w-full object-cover"
                            />
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3">
                              <div className="relative h-12 w-full max-w-[26rem] rounded-lg border-2 border-white/85 shadow-[0_0_0_999px_rgba(2,6,23,0.24)] sm:h-14">
                                <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-white/80 shadow-[0_0_18px_rgba(255,255,255,0.75)]" />
                              </div>
                            </div>
                            <div className="absolute left-3 top-3">
                              <StatusBadge
                                tone={
                                  loadScannerState === "active"
                                    ? "green"
                                    : "slate"
                                }
                                className="bg-white/95 shadow-sm"
                              >
                                {loadScannerState}
                              </StatusBadge>
                            </div>
                          </div>
                          <div className="border-t border-white/10 bg-slate-950 px-3 py-2 text-xs font-medium text-white">
                            <div className="flex items-center gap-2">
                              <ScanLine className="h-4 w-4 shrink-0" />
                              <span className="min-w-0">
                                {loadScannerMessage}
                              </span>
                            </div>
                          </div>
                        </div>

                        {loadScannerState === "active" ? (
                          <button
                            type="button"
                            onClick={stopLoadScanner}
                            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50 hover:text-slate-950"
                          >
                            <CameraOff className="h-4 w-4" />
                            Stop scanner
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void startLoadScanner()}
                            disabled={
                              loadScannerState === "starting" ||
                              source !== "database"
                            }
                            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {loadScannerState === "starting" ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <ScanLine className="h-4 w-4" />
                            )}
                            Start scanner
                          </button>
                        )}

                        {scannedPack ? (
                          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                            <div>
                              {scannedBackstockPack?.gameName ??
                                `Game ${scannedPack.gameId}`}{" "}
                              / Pack {scannedPack.packNumber}
                            </div>
                            {scannedBackstockPack ? (
                              <div className="mt-1 text-[11px] text-slate-500">
                                {getPackValueTicketCount(
                                  scannedBackstockPack,
                                ) ?? "-"}{" "}
                                tickets /{" "}
                                {getPackValue(scannedBackstockPack) === null
                                  ? "value not set"
                                  : formatCurrency(
                                      getPackValue(scannedBackstockPack) ?? 0,
                                    )}
                              </div>
                            ) : null}
                          </div>
                        ) : scannedPackBarcode.trim() ? (
                          <div className="rounded-2xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                            Scan the long lottery barcode from the pack.
                          </div>
                        ) : null}

                        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                          <label className="block">
                            <span className="mb-2 block text-[10px] font-bold uppercase text-slate-500">
                              Manual backstock
                            </span>
                            <select
                              value={manualPackId}
                              onChange={(event) => {
                                setManualPackId(event.target.value);

                                if (event.target.value) {
                                  setScannedPackBarcode("");
                                }
                              }}
                              disabled={
                                source !== "database" ||
                                backstockItems.length === 0
                              }
                              className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="">
                                {backstockItems.length > 0
                                  ? "Choose backstock pack"
                                  : "No backstock packs"}
                              </option>
                              {backstockItems.map((pack) => (
                                <option key={pack.id} value={pack.id}>
                                  {pack.gameName} / #{pack.gameId} / Pack{" "}
                                  {pack.packNumber}
                                </option>
                              ))}
                            </select>
                          </label>

                          {manualBackstockPack ? (
                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                              <div>
                                {manualBackstockPack.gameName} / Pack{" "}
                                {manualBackstockPack.packNumber}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {getPackValueTicketCount(manualBackstockPack) ??
                                  "-"}{" "}
                                tickets /{" "}
                                {getPackValue(manualBackstockPack) === null
                                  ? "value not set"
                                  : formatCurrency(
                                      getPackValue(manualBackstockPack) ?? 0,
                                    )}
                              </div>
                            </div>
                          ) : null}

                          <button
                            type="button"
                            disabled={
                              source !== "database" ||
                              !manualBackstockPack ||
                              actionState.type === "load" ||
                              Boolean(selectedBin.inventoryId)
                            }
                            onClick={() => void loadManualPackToBin()}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900 transition hover:border-teal-300 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionState.type === "load" &&
                            actionState.key === manualBackstockPack?.id ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <PackagePlus className="h-4 w-4" />
                            )}
                            Load selected pack
                          </button>
                        </div>

                        {selectedBin.inventoryId ? (
                          <div className="rounded-2xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                            Mark the current pack sold out before loading a
                            replacement. Sold-out packs are settled from EFT.
                          </div>
                        ) : null}

                        <button
                          type="button"
                          disabled={
                            source !== "database" ||
                            !scannedPack ||
                            actionState.type === "load" ||
                            Boolean(selectedBin.inventoryId)
                          }
                          onClick={() => void loadScannedPackToBin()}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionState.type === "load" ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <PackagePlus className="h-4 w-4" />
                          )}
                          Load scanned pack
                        </button>
                      </div>
                    </section>

                    {selectedBin.inventoryId && !isSoldOut(selectedBin) ? (
                      <section className="rounded-lg border border-red-200 bg-white p-4">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-red-50 text-red-700 ring-1 ring-inset ring-red-100">
                            <RotateCcw className="h-4 w-4" />
                          </span>
                          <h3 className="text-sm font-semibold text-red-950">
                            Return discontinued game
                          </h3>
                        </div>
                        <p className="mt-2 text-xs font-medium text-red-800">
                          Marks the active pack as returned and clears this bin.
                        </p>
                        <button
                          type="button"
                          disabled={
                            source !== "database" ||
                            actionState.type === "return"
                          }
                          onClick={() => void returnCurrentPack()}
                          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {actionState.type === "return" ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                          Return to lottery
                        </button>
                      </section>
                    ) : null}
                  </div>

                  <div className="space-y-4">
                    <PackDetailPanel
                      title="Current pack details"
                      icon={<Package className="h-4 w-4" />}
                      pack={selectedBin.currentPack}
                      emptyMessage="No current pack details were found."
                    />
                    <PackDetailPanel
                      title="Last pack in this bin"
                      icon={<History className="h-4 w-4" />}
                      pack={selectedBin.lastPack}
                      emptyMessage="No previous pack history was found for this bin."
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

export const ScratchCardAuditScreen = ScratchCardBinManager;
