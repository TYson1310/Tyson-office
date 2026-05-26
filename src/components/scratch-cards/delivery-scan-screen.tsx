"use client";

import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import {
  Archive,
  Camera,
  CameraOff,
  CheckCircle2,
  Focus,
  LoaderCircle,
  PackagePlus,
  Save,
  ScanLine,
  Trash2,
  XCircle,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { formatDateOnly, isDateOnlyString } from "@/lib/date-time";
import type { ScratchDeliveryLedgerItem } from "@/lib/scratch-cards/data";

type ScanStatus = "queued" | "saving" | "saved" | "failed";

type ScanResult = {
  id: string;
  barcode: string;
  barcodeKey: string;
  gameId: string | null;
  itemNumber: string | null;
  packNumber: string | null;
  rawValue: string;
  scannerFormat: string | null;
  ticketNumber: string | null;
  status: ScanStatus;
  message: string;
  scannedAt: string;
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

type ReceiveScratchPackPayload = {
  error?: string;
  inventory?: {
    binNumber?: number | null;
    createdAt?: string;
    dateReceived?: string;
    gameName?: string | null;
    gameTicketCount?: number | null;
    gameId?: string;
    id?: string;
    packControlCode?: string | null;
    packNumber?: string;
    packTicketCount?: number | null;
    status?: string;
    ticketNumber?: string | null;
    ticketPrice?: number;
  };
};

type DeliveryScanScreenProps = {
  canSelectDate: boolean;
  deliveryLedger: ScratchDeliveryLedgerItem[];
  ledgerErrorMessage?: string;
  selectedDate: string;
  todayDate: string;
};

declare global {
  interface Window {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
  }
}

const MIN_SCRATCH_BARCODE_DIGITS = 14;
const LOTTERY_ITF_ALLOWED_LENGTHS = [14, 16, 18, 20, 22, 24, 26, 28, 30];
const NATIVE_BARCODE_FORMATS = ["itf"];
const RECENT_SCAN_COOLDOWN_MS = 2500;
const SCANNER_FORMATS = [BarcodeFormat.ITF];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

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

type CameraTuneMode = "continuous" | "refocus";

function getInsecureCameraMessage() {
  if (typeof window === "undefined" || window.isSecureContext) {
    return "";
  }

  return "Camera is blocked on this HTTP network address. Restart the app with HTTPS and open the HTTPS URL on this device.";
}

function getCameraErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return error instanceof Error
      ? error.message
      : "Camera could not be started.";
  }

  if (error.name === "NotAllowedError") {
    return "Camera permission was blocked. Allow camera access for this site and try again.";
  }

  if (error.name === "NotFoundError") {
    return "No camera was found on this device.";
  }

  if (error.name === "NotReadableError") {
    return "Camera is already in use by another app or browser tab.";
  }

  return error.message || "Camera could not be started.";
}

function buildId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return formatDateOnly(value, undefined, "Not recorded");
}

function getLocalDateKey(value: string | null) {
  if (!value) {
    return "not-recorded";
  }

  const normalized = value.trim();

  if (isDateOnlyString(normalized)) {
    return normalized;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return "not-recorded";
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatNativeScannerFormat(format?: string) {
  return format ? format.replace(/-/g, "_").toUpperCase() : "NATIVE";
}

function getCameraVideoTrack(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;

  if (!(stream instanceof MediaStream)) {
    return null;
  }

  return stream.getVideoTracks()[0] ?? null;
}

async function applyMobileCameraTuning(
  video: HTMLVideoElement | null,
  mode: CameraTuneMode = "continuous",
) {
  const track = getCameraVideoTrack(video);

  if (!track?.applyConstraints) {
    return { applied: false, focusApplied: false };
  }

  const capabilities =
    typeof track.getCapabilities === "function"
      ? (track.getCapabilities() as ExtendedMediaTrackCapabilities)
      : {};
  const advanced: ExtendedMediaTrackConstraintSet[] = [];
  let focusApplied = false;

  if (mode === "refocus" && capabilities.focusMode?.includes("single-shot")) {
    advanced.push({ focusMode: "single-shot" });
    focusApplied = true;
  } else if (capabilities.focusMode?.includes("continuous")) {
    advanced.push({ focusMode: "continuous" });
    focusApplied = true;
  }

  if (capabilities.exposureMode?.includes("continuous")) {
    advanced.push({ exposureMode: "continuous" });
  }

  if (capabilities.whiteBalanceMode?.includes("continuous")) {
    advanced.push({ whiteBalanceMode: "continuous" });
  }

  if (advanced.length === 0) {
    return { applied: false, focusApplied: false };
  }

  try {
    await track.applyConstraints({ advanced } as MediaTrackConstraints);
    return { applied: true, focusApplied };
  } catch {
    return { applied: false, focusApplied: false };
  }
}

function getInvalidBarcodeMessage(value: string) {
  const trimmed = value.trim();
  const digitsOnly = trimmed.replace(/\D/g, "");

  if (digitsOnly.length === 12) {
    return "Wrong barcode read. Use the bottom long barcode.";
  }

  if (digitsOnly.length > 0 && digitsOnly.length < MIN_SCRATCH_BARCODE_DIGITS) {
    return `Barcode is too short: ${digitsOnly.length} digits read.`;
  }

  return "Does not match lottery pack format.";
}

function parseBarcode(value: string) {
  const trimmed = value.trim();
  const digitsOnly = trimmed.replace(/\D/g, "");

  if (digitsOnly.length < MIN_SCRATCH_BARCODE_DIGITS) {
    return null;
  }

  const gameId = digitsOnly.slice(0, 5);
  const packNumber = digitsOnly.slice(5, 11);
  const ticketNumber = digitsOnly.slice(11, 14);
  const itemNumber = digitsOnly.slice(14) || null;
  const barcode = `${gameId}-${packNumber}-${ticketNumber}`;
  const displayBarcode = itemNumber ? `${barcode}-${itemNumber}` : barcode;

  return {
    barcode,
    gameId,
    itemNumber,
    packNumber,
    rawValue: trimmed,
    scannedBarcode: displayBarcode,
    ticketNumber,
  };
}

function statusTone(status: ScanStatus) {
  if (status === "saved") {
    return "green" as const;
  }

  if (status === "failed") {
    return "red" as const;
  }

  if (status === "saving") {
    return "blue" as const;
  }

  return "slate" as const;
}

function statusIcon(status: ScanStatus) {
  if (status === "saved") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }

  if (status === "failed") {
    return <XCircle className="h-4 w-4 text-red-600" />;
  }

  if (status === "saving") {
    return <LoaderCircle className="h-4 w-4 animate-spin text-sky-600" />;
  }

  return <PackagePlus className="h-4 w-4 text-slate-500" />;
}

function getLedgerTicketCount(item: ScratchDeliveryLedgerItem) {
  return item.gameTicketCount ?? null;
}

function getLedgerPackValue(item: ScratchDeliveryLedgerItem) {
  const ticketCount = getLedgerTicketCount(item);

  if (!ticketCount || item.ticketPrice <= 0) {
    return null;
  }

  return ticketCount * item.ticketPrice;
}

function buildDeliveryLedgerTotals(items: ScratchDeliveryLedgerItem[]) {
  const totalsByDate = new Map<
    string,
    {
      date: string;
      latestReceivedAt: number;
      totalAmount: number;
      totalPacks: number;
    }
  >();

  for (const item of items) {
    const dateKey = getLocalDateKey(item.dateReceived);
    const receivedAt = item.dateReceived
      ? new Date(item.dateReceived).getTime()
      : 0;
    const current = totalsByDate.get(dateKey) ?? {
      date: formatDate(item.dateReceived),
      latestReceivedAt: 0,
      totalAmount: 0,
      totalPacks: 0,
    };

    current.latestReceivedAt = Math.max(
      current.latestReceivedAt,
      Number.isFinite(receivedAt) ? receivedAt : 0,
    );
    current.totalAmount =
      Math.round(
        (current.totalAmount + (getLedgerPackValue(item) ?? 0)) * 100,
      ) / 100;
    current.totalPacks += 1;
    totalsByDate.set(dateKey, current);
  }

  return Array.from(totalsByDate.values()).sort(
    (left, right) => right.latestReceivedAt - left.latestReceivedAt,
  );
}

function buildLedgerItemFromSavedScan(
  scan: ScanResult,
  payload: ReceiveScratchPackPayload,
) {
  const inventory = payload.inventory;
  const gameId = inventory?.gameId ?? scan.gameId ?? "";
  const packNumber = inventory?.packNumber ?? scan.packNumber ?? "";

  return {
    id: inventory?.id ?? scan.id,
    binNumber: inventory?.binNumber ?? null,
    dateReceived:
      inventory?.dateReceived ??
      inventory?.createdAt ??
      new Date().toISOString(),
    gameId,
    gameName:
      inventory?.gameName ?? (gameId ? `Game #${gameId}` : "Unknown game"),
    gameTicketCount: inventory?.gameTicketCount ?? null,
    packControlCode: inventory?.packControlCode ?? null,
    packId: scan.barcodeKey,
    packNumber,
    packTicketCount: inventory?.packTicketCount ?? null,
    receivedTicketNumber: inventory?.ticketNumber ?? scan.ticketNumber,
    status: inventory?.status ?? "backstock",
    ticketPrice: inventory?.ticketPrice ?? 0,
  } satisfies ScratchDeliveryLedgerItem;
}

export function DeliveryScanScreen({
  canSelectDate,
  deliveryLedger,
  ledgerErrorMessage,
  selectedDate,
  todayDate,
}: DeliveryScanScreenProps) {
  const { error: notifyError, success } = useAppNotifications();
  const pathname = usePathname();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const nativeDetectorRef = useRef<NativeBarcodeDetectorInstance | null>(null);
  const nativeDetectorTimerRef = useRef<number | null>(null);
  const nativeDetectorBusyRef = useRef(false);
  const recentScansRef = useRef<Map<string, number>>(new Map());
  const stagedBarcodeKeysRef = useRef<Set<string>>(new Set());
  const [isRefocusing, setIsRefocusing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving">("idle");
  const [cameraState, setCameraState] = useState<
    "idle" | "starting" | "active" | "unsupported" | "error"
  >("idle");
  const [secureContextMessage, setSecureContextMessage] = useState("");
  const [cameraMessage, setCameraMessage] = useState("Start camera.");
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [deliveryLedgerItems, setDeliveryLedgerItems] =
    useState(deliveryLedger);
  const deliveryLedgerTotals = useMemo(
    () => buildDeliveryLedgerTotals(deliveryLedgerItems),
    [deliveryLedgerItems],
  );

  const changeSelectedDate = useCallback(
    (value: string) => {
      router.replace(`${pathname}?date=${encodeURIComponent(value)}`);
    },
    [pathname, router],
  );

  const receiveBarcode = useCallback(
    async (
      rawBarcode: string,
      options?: { force?: boolean; scannerFormat?: string },
    ) => {
      const rawValue = rawBarcode.trim();
      const parsed = parseBarcode(rawBarcode);

      if (!parsed) {
        const invalidKey = `invalid:${rawValue}`;
        const now = Date.now();
        const recentInvalidScanAt = recentScansRef.current.get(invalidKey) ?? 0;

        if (
          options?.force ||
          now - recentInvalidScanAt >= RECENT_SCAN_COOLDOWN_MS
        ) {
          recentScansRef.current.set(invalidKey, now);
          setScanResults((current) =>
            [
              {
                barcode: rawValue || "Unreadable barcode",
                barcodeKey: `invalid:${rawValue}`,
                gameId: null,
                id: buildId(),
                itemNumber: null,
                message: options?.scannerFormat
                  ? `${getInvalidBarcodeMessage(rawValue)} · ${options.scannerFormat}`
                  : getInvalidBarcodeMessage(rawValue),
                packNumber: null,
                rawValue,
                scannerFormat: options?.scannerFormat ?? null,
                scannedAt: new Date().toISOString(),
                status: "failed" as const,
                ticketNumber: null,
              },
              ...current,
            ].slice(0, 60),
          );
        }

        if (options?.force) {
          notifyError(
            "Barcode must match GGGGG-PPPPPP-TTT with optional check code.",
          );
        }

        return;
      }

      const now = Date.now();
      const recentScanAt = recentScansRef.current.get(parsed.barcode) ?? 0;

      if (!options?.force && now - recentScanAt < RECENT_SCAN_COOLDOWN_MS) {
        return;
      }

      if (stagedBarcodeKeysRef.current.has(parsed.barcode)) {
        setCameraMessage("Duplicate barcode ignored.");

        if (options?.force) {
          notifyError("This barcode is already in the delivery list.");
        }

        return;
      }

      recentScansRef.current.set(parsed.barcode, now);
      stagedBarcodeKeysRef.current.add(parsed.barcode);

      const resultId = buildId();
      const baseResult = {
        id: resultId,
        ...parsed,
        barcode: parsed.scannedBarcode,
        barcodeKey: parsed.barcode,
        scannerFormat: options?.scannerFormat ?? null,
        status: "queued" as const,
        message: "Ready to save",
        scannedAt: new Date().toISOString(),
      };

      setScanResults((current) => [baseResult, ...current]);
      setCameraMessage("Pack added to delivery list.");
    },
    [notifyError],
  );

  const stopNativeDetector = useCallback(() => {
    if (nativeDetectorTimerRef.current !== null) {
      window.clearTimeout(nativeDetectorTimerRef.current);
      nativeDetectorTimerRef.current = null;
    }

    nativeDetectorRef.current = null;
    nativeDetectorBusyRef.current = false;
  }, []);

  const startNativeDetector = useCallback(async () => {
    const Detector = window.BarcodeDetector;

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

    nativeDetectorRef.current = new Detector({ formats });

    const scanVideo = async () => {
      const detector = nativeDetectorRef.current;
      const video = videoRef.current;

      if (!detector || !video) {
        return;
      }

      if (video.readyState >= 2 && !nativeDetectorBusyRef.current) {
        nativeDetectorBusyRef.current = true;

        try {
          const detections = await detector.detect(video);
          const detection = detections.find((item) => item.rawValue);

          if (detection?.rawValue) {
            void receiveBarcode(detection.rawValue, {
              scannerFormat: formatNativeScannerFormat(detection.format),
            });
          }
        } catch {
          stopNativeDetector();
          return;
        } finally {
          nativeDetectorBusyRef.current = false;
        }
      }

      nativeDetectorTimerRef.current = window.setTimeout(scanVideo, 180);
    };

    nativeDetectorTimerRef.current = window.setTimeout(scanVideo, 180);
    return true;
  }, [receiveBarcode, stopNativeDetector]);

  const stopCamera = useCallback(() => {
    stopNativeDetector();
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraState("idle");
    setCameraMessage("Camera stopped.");
  }, [stopNativeDetector]);

  const refocusCamera = useCallback(async () => {
    if (cameraState !== "active" || isRefocusing) {
      return;
    }

    setIsRefocusing(true);
    setCameraMessage("Refocusing camera.");

    const cameraTuning = await applyMobileCameraTuning(
      videoRef.current,
      "refocus",
    );

    setCameraMessage(
      cameraTuning.focusApplied
        ? "Camera focus refreshed. Hold the barcode anywhere in the scan lane."
        : cameraTuning.applied
          ? "Camera tuning refreshed. Hold the barcode anywhere in the scan lane."
          : "Refocus is not supported on this phone browser.",
    );
    setIsRefocusing(false);
  }, [cameraState, isRefocusing]);

  const startCamera = useCallback(async () => {
    const insecureCameraMessage = getInsecureCameraMessage();

    if (insecureCameraMessage) {
      setCameraState("unsupported");
      setSecureContextMessage(insecureCameraMessage);
      setCameraMessage(insecureCameraMessage);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      setCameraMessage("Camera access is not available in this browser.");
      return;
    }

    setCameraState("starting");
    setCameraMessage("Starting camera.");

    try {
      const video = videoRef.current;

      if (!video) {
        throw new Error("Camera preview is not ready.");
      }

      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.ALLOWED_LENGTHS, LOTTERY_ITF_ALLOWED_LENGTHS);
      hints.set(DecodeHintType.POSSIBLE_FORMATS, SCANNER_FORMATS);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 150,
        delayBetweenScanSuccess: RECENT_SCAN_COOLDOWN_MS,
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
          const format = result?.getBarcodeFormat();

          if (barcode) {
            void receiveBarcode(barcode, {
              scannerFormat:
                format === undefined
                  ? undefined
                  : (BarcodeFormat[format] ?? String(format)),
            });
          }
        },
      );

      scannerControlsRef.current = controls;
      const nativeDetectorStarted = await startNativeDetector();
      const cameraTuning = await applyMobileCameraTuning(video);
      setCameraMessage(
        nativeDetectorStarted
          ? "Android scanner is on. Hold the long barcode anywhere in the scan lane."
          : cameraTuning.focusApplied
            ? "Continuous focus is on. Hold the long barcode anywhere in the scan lane."
            : cameraTuning.applied
              ? "Camera tuning is on. Hold the long barcode anywhere in the scan lane."
              : "Scanner active. Hold the long barcode anywhere in the scan lane.",
      );
      setCameraState("active");
    } catch (error) {
      setCameraState("error");
      setCameraMessage(getCameraErrorMessage(error));
    }
  }, [receiveBarcode, startNativeDetector]);

  useEffect(() => {
    const insecureCameraMessage = getInsecureCameraMessage();

    if (!insecureCameraMessage) {
      return;
    }

    setSecureContextMessage(insecureCameraMessage);
    setCameraState("unsupported");
    setCameraMessage(insecureCameraMessage);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    setDeliveryLedgerItems(deliveryLedger);
  }, [deliveryLedger]);

  function removeScanResult(result: ScanResult) {
    if (result.status === "saving") {
      return;
    }

    if (result.gameId) {
      stagedBarcodeKeysRef.current.delete(result.barcodeKey);
      recentScansRef.current.delete(result.barcodeKey);
    }

    setScanResults((current) =>
      current.filter((item) => item.id !== result.id),
    );
  }

  async function saveDelivery() {
    const itemsToSave = scanResults.filter(
      (result) =>
        result.gameId &&
        (result.status === "queued" || result.status === "failed"),
    );

    if (itemsToSave.length === 0) {
      notifyError("No unsaved delivery scans are ready to save.");
      return;
    }

    setSaveState("saving");

    let savedCount = 0;
    let failedSaveCount = 0;
    const savedLedgerItems: ScratchDeliveryLedgerItem[] = [];

    for (const item of [...itemsToSave].reverse()) {
      setScanResults((current) =>
        current.map((result) =>
          result.id === item.id
            ? { ...result, message: "Saving to inventory", status: "saving" }
            : result,
        ),
      );

      try {
        const response = await fetch("/api/scratch-cards/receive", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            barcode: item.barcodeKey,
            receivedDate: selectedDate,
          }),
        });
        const payload = (await response.json()) as ReceiveScratchPackPayload;

        if (!response.ok) {
          throw new Error(payload.error ?? "Pack could not be saved");
        }

        savedCount += 1;
        savedLedgerItems.push(buildLedgerItemFromSavedScan(item, payload));
        setScanResults((current) =>
          current.map((result) =>
            result.id === item.id
              ? {
                  ...result,
                  message: "Saved to inventory",
                  status: "saved",
                }
              : result,
          ),
        );
      } catch (error) {
        failedSaveCount += 1;
        setScanResults((current) =>
          current.map((result) =>
            result.id === item.id
              ? {
                  ...result,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Pack could not be saved",
                  status: "failed",
                }
              : result,
          ),
        );
      }
    }

    setSaveState("idle");

    if (savedLedgerItems.length > 0) {
      setDeliveryLedgerItems((current) => {
        const savedIds = new Set(savedLedgerItems.map((item) => item.id));

        return [
          ...savedLedgerItems.reverse(),
          ...current.filter((item) => !savedIds.has(item.id)),
        ].slice(0, 100);
      });
    }

    if (savedCount > 0) {
      success(
        `${savedCount} pack${savedCount === 1 ? "" : "s"} saved to inventory.`,
      );
    }

    if (failedSaveCount > 0) {
      notifyError(
        `${failedSaveCount} pack${
          failedSaveCount === 1 ? "" : "s"
        } could not be saved.`,
      );
    }
  }

  const scannedCount = scanResults.filter((result) => result.gameId).length;
  const unsavedCount = scanResults.filter(
    (result) => result.gameId && result.status === "queued",
  ).length;
  const saveReadyCount = scanResults.filter(
    (result) =>
      result.gameId &&
      (result.status === "queued" || result.status === "failed"),
  ).length;
  const savedCount = scanResults.filter(
    (result) => result.status === "saved",
  ).length;
  const failedCount = scanResults.filter(
    (result) => result.status === "failed",
  ).length;

  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      <SectionCard
        title="Delivery date"
        description="Scanned packs will be received on this date."
        action={
          <input
            type="date"
            value={selectedDate}
            max={todayDate}
            onChange={(event) => changeSelectedDate(event.target.value)}
            disabled={!canSelectDate}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
          />
        }
        className="rounded-lg sm:rounded-lg"
        headerClassName="px-4 py-3 sm:px-4"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          detail="valid barcodes scanned"
          icon={<ScanLine className="h-5 w-5" />}
          label="Scan qty"
          tone="blue"
          value={scannedCount}
        />
        <StatCard
          detail="ready to save"
          icon={<PackagePlus className="h-5 w-5" />}
          label="Unsaved"
          tone="amber"
          value={unsavedCount}
        />
        <StatCard
          detail="saved this session"
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Saved"
          tone="green"
          value={savedCount}
        />
        <StatCard
          detail="needs review"
          icon={<XCircle className="h-5 w-5" />}
          label="Failed"
          tone={failedCount > 0 ? "red" : "slate"}
          value={failedCount}
        />
      </div>

      <SectionCard
        title="Delivery list"
        description="Scan delivered scratch card packs into this list, then save the delivery to inventory."
        className="rounded-lg sm:rounded-lg"
        headerClassName="px-4 py-3 sm:px-4"
        action={
          <>
            {cameraState === "active" ? (
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200/90 bg-white/90 px-4 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur-sm transition hover:border-teal-200 hover:bg-teal-50 hover:text-slate-950 sm:w-auto"
              >
                <CameraOff className="h-4 w-4" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startCamera()}
                disabled={
                  cameraState === "starting" || Boolean(secureContextMessage)
                }
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
              >
                {cameraState === "starting" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                Start camera
              </button>
            )}

            <button
              type="button"
              onClick={() => void saveDelivery()}
              disabled={saveReadyCount === 0 || saveState === "saving"}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
            >
              {saveState === "saving" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save delivery
              {saveReadyCount > 0 ? ` (${saveReadyCount})` : ""}
            </button>
          </>
        }
      >
        {secureContextMessage ? (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {secureContextMessage}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
          <div className="relative h-[150px] bg-slate-950 sm:h-[190px] lg:h-[230px]">
            <video
              ref={videoRef}
              muted
              playsInline
              className="block h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3">
              <div className="relative h-14 w-full max-w-[36rem] rounded-lg border-2 border-white/85 shadow-[0_0_0_999px_rgba(2,6,23,0.24)] sm:h-16">
                <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-white/80 shadow-[0_0_18px_rgba(255,255,255,0.75)]" />
              </div>
            </div>
            <div className="absolute left-3 top-3 sm:left-4 sm:top-4">
              <StatusBadge tone={cameraState === "active" ? "green" : "slate"}>
                {cameraState}
              </StatusBadge>
            </div>
            {cameraState === "active" ? (
              <button
                type="button"
                onClick={() => void refocusCamera()}
                disabled={isRefocusing}
                className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-slate-950/70 text-white shadow-sm backdrop-blur-sm transition hover:bg-slate-900 disabled:cursor-wait disabled:opacity-70 sm:right-4 sm:top-4"
                aria-label="Refocus camera"
              >
                {isRefocusing ? (
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                ) : (
                  <Focus className="h-5 w-5" />
                )}
              </button>
            ) : null}
          </div>
          <div className="border-t border-white/10 bg-slate-950 px-3 py-2 text-xs font-medium text-white sm:px-4 sm:text-sm">
            <div className="flex items-center gap-2">
              <ScanLine className="h-4 w-4 shrink-0" />
              <span className="min-w-0">{cameraMessage}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-200/80 pt-4">
          {scanResults.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              No packs added to this delivery list.
            </div>
          ) : (
            <div className="space-y-2">
              {scanResults.map((result) => (
                <div
                  key={result.id}
                  className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-50">
                      {statusIcon(result.status)}
                    </div>
                    <div className="min-w-0">
                      <div className="break-words font-mono text-sm font-semibold leading-5 text-slate-950">
                        {result.barcode}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {result.gameId &&
                        result.packNumber &&
                        result.ticketNumber ? (
                          <>
                            Game #{result.gameId} · Pack {result.packNumber} ·
                            Ticket {result.ticketNumber}
                            {result.itemNumber
                              ? ` · Item ${result.itemNumber}`
                              : ""}
                            {result.scannerFormat
                              ? ` · ${result.scannerFormat}`
                              : ""}
                          </>
                        ) : (
                          "Raw scan did not match a lottery pack barcode"
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <StatusBadge tone={statusTone(result.status)}>
                      {result.status}
                    </StatusBadge>
                    <span className="min-w-0 text-xs text-slate-500">
                      {result.message}
                    </span>
                    {result.status !== "saving" && result.status !== "saved" ? (
                      <button
                        type="button"
                        onClick={() => removeScanResult(result)}
                        className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 sm:ml-0 sm:h-8 sm:w-8 sm:rounded-full"
                        aria-label="Remove scan from delivery list"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Delivery ledger"
        description="Daily totals from saved delivery scans."
        className="rounded-lg sm:rounded-lg"
        headerClassName="px-4 py-3 sm:px-4"
      >
        {ledgerErrorMessage ? (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {ledgerErrorMessage}
          </div>
        ) : null}

        {deliveryLedgerTotals.length > 0 ? (
          <div className="overflow-x-auto">
            <Table totalRows={deliveryLedgerTotals.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">
                    Total packs received
                  </TableHead>
                  <TableHead className="text-right">Total amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveryLedgerTotals.map((item) => (
                  <TableRow key={item.date}>
                    <TableCell className="font-semibold text-slate-950">
                      {item.date}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-slate-800">
                      {item.totalPacks}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-slate-800">
                      {formatCurrency(item.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm">
              <Archive className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-950">
                No delivery ledger yet
              </div>
              <div className="mt-1 text-sm text-slate-500">
                Saved delivery scans will appear here.
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {saveReadyCount > 0 ? (
        <div className="fixed inset-x-3 bottom-3 z-40 rounded-lg border border-slate-200 bg-white p-2 shadow-lg lg:hidden">
          <button
            type="button"
            onClick={() => void saveDelivery()}
            disabled={saveState === "saving"}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saveState === "saving" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save delivery ({saveReadyCount})
          </button>
        </div>
      ) : null}
    </div>
  );
}
