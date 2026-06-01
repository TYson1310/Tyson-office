"use client";

import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calculator,
  CameraOff,
  CheckCircle2,
  DollarSign,
  LoaderCircle,
  Lock,
  Receipt,
  Save,
  ScanLine,
  Ticket,
  Wallet,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { StatusBadge } from "@/components/erp/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";
import { useAppNotifications } from "@/contexts/NotificationContext";
import type { LotteryEodReconciliationData } from "@/lib/lottery/eod-reconciliation";
import type { ScratchAuditBin } from "@/lib/scratch-cards/data";

type EodReconciliationWorkbenchProps = {
  canSelectDate: boolean;
  data: LotteryEodReconciliationData;
  todayDate: string;
};

type SaveState = {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
};

const SAVED_RECONCILIATION_MESSAGE =
  "Lottery EOD reconciliation is already saved for this date.";

type ScannerState = "active" | "error" | "idle" | "starting" | "unsupported";

type ScannedTicketBarcode = {
  barcode: string;
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

type SummaryCardProps = {
  detail: string;
  icon: ReactNode;
  label: string;
  tone: "blue" | "green" | "red" | "slate";
  value: string;
};

type CashEntryKey =
  | "cashingBonus"
  | "lotteryBondFee"
  | "onlineTotalPayout"
  | "scratchCardTotalPayout"
  | "startingFloat"
  | "terminalSales"
  | "ticketCancels"
  | "tillCash";

type CashEntryField = {
  amount: number;
  description: string;
  key: CashEntryKey;
  label: string;
  value: string;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const MIN_SCRATCH_BARCODE_DIGITS = 14;
const LOTTERY_ITF_ALLOWED_LENGTHS = [14, 16, 18, 20, 22, 24, 26, 28, 30];
const NATIVE_BARCODE_FORMATS = ["itf"];
const RECENT_SCAN_COOLDOWN_MS = 2500;
const SCANNER_FORMATS = [BarcodeFormat.ITF];

const summaryToneClasses = {
  blue: "border-blue/15 bg-blue/5 text-blue",
  green: "border-green/15 bg-green/5 text-green",
  red: "border-red/15 bg-red/5 text-red",
  slate: "border-stroke bg-white text-primary",
} as const;

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function normalizeMoney(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function normalizeTicketInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 3);
}

function toTicketNumber(value: string) {
  if (!/^[0-9]{1,3}$/.test(value)) {
    return null;
  }

  return String(Number(value)).padStart(3, "0");
}

function moneyInputToNumber(value: string) {
  if (!value) {
    return 0;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0
    ? normalizeMoney(normalized)
    : 0;
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

function parseScannedTicketBarcode(value: string): ScannedTicketBarcode | null {
  const digitsOnly = value.replace(/\D/g, "");

  if (digitsOnly.length < MIN_SCRATCH_BARCODE_DIGITS) {
    return null;
  }

  const gameId = digitsOnly.slice(0, 5);
  const packNumber = digitsOnly.slice(5, 11);
  const ticketNumber = digitsOnly.slice(11, 14);
  const itemNumber = digitsOnly.slice(14) || null;

  return {
    barcode: `${gameId}-${packNumber}-${ticketNumber}`,
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

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function getShortOverStatus(shortOver: number) {
  if (shortOver > 0) {
    return {
      label: "Short",
      tone: "red" as const,
    };
  }

  if (shortOver < 0) {
    return {
      label: "Over",
      tone: "green" as const,
    };
  }

  return {
    label: "Balanced",
    tone: "green" as const,
  };
}

function getPackTicketCount(bin: ScratchAuditBin) {
  return bin.currentPack?.gameTicketCount ?? null;
}

function getFinalTicketValue(ticketCount: number | null) {
  if (!ticketCount || ticketCount > 1000) {
    return null;
  }

  return ticketCount - 1;
}

function calculateBinSales(bin: ScratchAuditBin, endTicketInput: string) {
  const endTicketNumber = toTicketNumber(endTicketInput);
  const packTicketCount = getPackTicketCount(bin);
  const finalTicketValue = getFinalTicketValue(packTicketCount);

  if (!bin.inventoryId || !endTicketNumber) {
    return {
      endTicketNumber,
      isValid: false,
      resetApplied: false,
      sales: 0,
      ticketsSold: 0,
    };
  }

  if (finalTicketValue !== null && Number(endTicketNumber) > finalTicketValue) {
    return {
      endTicketNumber,
      isValid: false,
      resetApplied: false,
      sales: 0,
      ticketsSold: 0,
    };
  }

  const rawTicketsSold = Number(endTicketNumber) - Number(bin.lastTicketNumber);
  const resetApplied = rawTicketsSold < 0 && bin.canResetTicketNumber;

  if (rawTicketsSold < 0 && !resetApplied) {
    return {
      endTicketNumber,
      isValid: false,
      resetApplied: false,
      sales: 0,
      ticketsSold: 0,
    };
  }

  const ticketsSold = resetApplied ? Number(endTicketNumber) : rawTicketsSold;

  return {
    endTicketNumber,
    isValid: true,
    resetApplied,
    sales: normalizeMoney(ticketsSold * bin.ticketPrice),
    ticketsSold,
  };
}

function buildInitialBinInputs(bins: ScratchAuditBin[]) {
  return Object.fromEntries(
    bins
      .filter((bin) => bin.inventoryId)
      .map((bin) => [bin.binNumber, bin.lastTicketNumber]),
  );
}

function getSortedActiveBins(bins: ScratchAuditBin[]) {
  return [...bins].sort((left, right) => left.binNumber - right.binNumber);
}

function getAdjacentBinNumber(
  bins: ScratchAuditBin[],
  currentBinNumber: number,
  direction: "next" | "previous",
) {
  const sortedBins = getSortedActiveBins(bins);
  const currentIndex = sortedBins.findIndex(
    (bin) => bin.binNumber === currentBinNumber,
  );

  if (currentIndex < 0) {
    return null;
  }

  return (
    sortedBins[direction === "next" ? currentIndex + 1 : currentIndex - 1]
      ?.binNumber ?? null
  );
}

function getFirstBinNumber(bins: ScratchAuditBin[]) {
  return getSortedActiveBins(bins)[0]?.binNumber ?? null;
}

function SummaryCard({ detail, icon, label, tone, value }: SummaryCardProps) {
  return (
    <div className="rounded-[28px] border border-stroke bg-white p-5 shadow-sm dark:border-dark-3 dark:bg-dark-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-dark-5">
            {label}
          </p>
          <p className="mt-3 break-words text-2xl font-black text-dark dark:text-white">
            {value}
          </p>
          <p className="mt-1 text-xs text-dark-5">{detail}</p>
        </div>
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${summaryToneClasses[tone]}`}
        >
          {icon}
        </span>
      </div>
    </div>
  );
}

function getSavedReconciliationState(): SaveState {
  return {
    status: "saved",
    message: SAVED_RECONCILIATION_MESSAGE,
  };
}

export function EodReconciliationWorkbench({
  canSelectDate,
  data,
  todayDate,
}: EodReconciliationWorkbenchProps) {
  const { error: notifyError, success } = useAppNotifications();
  const pathname = usePathname();
  const router = useRouter();
  const activeBinsRef = useRef<ScratchAuditBin[]>([]);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const nativeDetectorRef = useRef<NativeBarcodeDetectorInstance | null>(null);
  const nativeDetectorTimerRef = useRef<number | null>(null);
  const nativeDetectorBusyRef = useRef(false);
  const recentScanRef = useRef<{
    barcode: string;
    scannedAt: number;
  } | null>(null);
  const loadedBusinessDateRef = useRef(data.businessDate);
  const scannerBinNumberRef = useRef<number | null>(null);
  const activeBins = useMemo(
    () => data.bins.filter((bin) => bin.inventoryId),
    [data.bins],
  );
  const shouldLockSavedReconciliation = data.isReconciled && !canSelectDate;
  const [binInputs, setBinInputs] = useState<Record<number, string>>(() =>
    buildInitialBinInputs(activeBins),
  );
  const [submittedBinSignature, setSubmittedBinSignature] = useState<
    string | null
  >(null);
  const [terminalSales, setTerminalSales] = useState(
    String(data.terminalSales || ""),
  );
  const [ticketCancels, setTicketCancels] = useState(
    String(data.ticketCancels || ""),
  );
  const [cashingBonus, setCashingBonus] = useState(
    String(data.cashingBonus || ""),
  );
  const [lotteryBondFee, setLotteryBondFee] = useState(
    String(data.lotteryBondFee || ""),
  );
  const [onlineTotalPayout, setOnlineTotalPayout] = useState(
    String(data.onlineTotalPayout || ""),
  );
  const [scratchCardTotalPayout, setScratchCardTotalPayout] = useState(
    String(data.scratchCardTotalPayout || ""),
  );
  const [startingFloat, setStartingFloat] = useState(
    String(data.startingFloat || ""),
  );
  const [tillCash, setTillCash] = useState(String(data.tillCash || ""));
  const [activeTab, setActiveTab] = useState<"closeout" | "log">("log");
  const [cashEntryType, setCashEntryType] =
    useState<CashEntryKey>("startingFloat");
  const [cashEntryAmount, setCashEntryAmount] = useState("");
  const [managerNotes, setManagerNotes] = useState(data.managerNotes);
  const [saveState, setSaveState] = useState<SaveState>(() =>
    shouldLockSavedReconciliation
      ? getSavedReconciliationState()
      : { status: "idle" },
  );
  const [reconciliationLocked, setReconciliationLocked] = useState(
    shouldLockSavedReconciliation,
  );
  const [scannerBinNumber, setScannerBinNumber] = useState<number | null>(null);
  const [scannerMessage, setScannerMessage] = useState("Start scanner.");
  const [scannerState, setScannerState] = useState<ScannerState>("idle");

  const scannerBin = useMemo(
    () => activeBins.find((bin) => bin.binNumber === scannerBinNumber) ?? null,
    [activeBins, scannerBinNumber],
  );
  const previousScannerBinNumber = scannerBin
    ? getAdjacentBinNumber(activeBins, scannerBin.binNumber, "previous")
    : null;
  const nextScannerBinNumber = scannerBin
    ? getAdjacentBinNumber(activeBins, scannerBin.binNumber, "next")
    : null;
  const binCalculations = useMemo(
    () =>
      activeBins.map((bin) => ({
        bin,
        calculation: calculateBinSales(bin, binInputs[bin.binNumber] ?? ""),
      })),
    [activeBins, binInputs],
  );
  const binsReady = binCalculations.every((item) => item.calculation.isValid);
  const binSubmissionSignature = useMemo(
    () =>
      binCalculations
        .map(
          ({ bin, calculation }) =>
            `${bin.binNumber}:${calculation.endTicketNumber ?? ""}`,
        )
        .join("|"),
    [binCalculations],
  );
  const binTicketsSubmitted =
    reconciliationLocked ||
    activeBins.length === 0 ||
    (binsReady && submittedBinSignature === binSubmissionSignature);
  const scratchSales = normalizeMoney(
    binCalculations.reduce((total, item) => total + item.calculation.sales, 0),
  );
  const terminalSalesTotal = moneyInputToNumber(terminalSales);
  const ticketCancelsTotal = moneyInputToNumber(ticketCancels);
  const cashingBonusTotal = moneyInputToNumber(cashingBonus);
  const lotteryBondFeeTotal = moneyInputToNumber(lotteryBondFee);
  const onlinePayoutTotal = moneyInputToNumber(onlineTotalPayout);
  const scratchPayoutTotal = moneyInputToNumber(scratchCardTotalPayout);
  const startingFloatTotal = moneyInputToNumber(startingFloat);
  const tillCashTotal = moneyInputToNumber(tillCash);
  const lotteryCashAdvanceNetImpact = normalizeMoney(
    data.lotteryCashAdvanceNetImpact,
  );
  const scratchSalesTotal = normalizeMoney(
    data.scratchSalesToDate + scratchSales,
  );
  const totalDeductions = normalizeMoney(
    ticketCancelsTotal +
      cashingBonusTotal +
      onlinePayoutTotal +
      scratchPayoutTotal,
  );
  const totalExpectedCash = normalizeMoney(
    Math.max(
      startingFloatTotal +
        scratchSalesTotal +
        terminalSalesTotal -
        totalDeductions,
      0,
    ),
  );
  const shortOver = normalizeMoney(totalExpectedCash - tillCashTotal);
  const shortOverStatus = getShortOverStatus(shortOver);
  const canSave =
    data.source === "database" &&
    binTicketsSubmitted &&
    !reconciliationLocked &&
    saveState.status !== "saving";
  const cashEntryFields = useMemo<CashEntryField[]>(
    () => [
      {
        amount: startingFloatTotal,
        description: "Cash bank placed in the lottery drawer at start of day",
        key: "startingFloat",
        label: "Starting float",
        value: startingFloat,
      },
      {
        amount: terminalSalesTotal,
        description: "Online lottery sales from terminal report",
        key: "terminalSales",
        label: "Terminal sales",
        value: terminalSales,
      },
      {
        amount: ticketCancelsTotal,
        description: "Cancelled online tickets",
        key: "ticketCancels",
        label: "Ticket cancels",
        value: ticketCancels,
      },
      {
        amount: cashingBonusTotal,
        description: "PROMO credit deducted from cash and EFT",
        key: "cashingBonus",
        label: "PROMO",
        value: cashingBonus,
      },
      {
        amount: lotteryBondFeeTotal,
        description: "EFT only; does not change cash variance",
        key: "lotteryBondFee",
        label: "Lottery bond fee",
        value: lotteryBondFee,
      },
      {
        amount: onlinePayoutTotal,
        description: "Online lottery prize payouts",
        key: "onlineTotalPayout",
        label: "Online total payout",
        value: onlineTotalPayout,
      },
      {
        amount: scratchPayoutTotal,
        description: "Scratch card prize payouts",
        key: "scratchCardTotalPayout",
        label: "Scratch card payout",
        value: scratchCardTotalPayout,
      },
      {
        amount: tillCashTotal,
        description: "Actual cash counted in the lottery drawer",
        key: "tillCash",
        label: "Cash counted in lottery drawer",
        value: tillCash,
      },
    ],
    [
      cashingBonus,
      cashingBonusTotal,
      lotteryBondFee,
      lotteryBondFeeTotal,
      onlinePayoutTotal,
      onlineTotalPayout,
      scratchCardTotalPayout,
      scratchPayoutTotal,
      startingFloat,
      startingFloatTotal,
      terminalSales,
      terminalSalesTotal,
      ticketCancels,
      ticketCancelsTotal,
      tillCash,
      tillCashTotal,
    ],
  );
  const selectedCashEntry =
    cashEntryFields.find((field) => field.key === cashEntryType) ??
    cashEntryFields[0];
  const binSubmissionStatus = binTicketsSubmitted
    ? { label: "Submitted", tone: "green" as const }
    : binsReady
      ? { label: "Ready to submit", tone: "amber" as const }
      : { label: "Needs end tickets", tone: "red" as const };

  const changeSelectedDate = useCallback(
    (value: string) => {
      router.replace(`${pathname}?date=${encodeURIComponent(value)}`);
    },
    [pathname, router],
  );

  function setCashEntryValue(type: CashEntryKey, value: string) {
    if (type === "startingFloat") {
      setStartingFloat(value);
    } else if (type === "terminalSales") {
      setTerminalSales(value);
    } else if (type === "ticketCancels") {
      setTicketCancels(value);
    } else if (type === "cashingBonus") {
      setCashingBonus(value);
    } else if (type === "lotteryBondFee") {
      setLotteryBondFee(value);
    } else if (type === "onlineTotalPayout") {
      setOnlineTotalPayout(value);
    } else if (type === "scratchCardTotalPayout") {
      setScratchCardTotalPayout(value);
    } else {
      setTillCash(value);
    }
  }

  function submitCashEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (reconciliationLocked) {
      notifyError(SAVED_RECONCILIATION_MESSAGE);
      return;
    }

    const amount = Number(cashEntryAmount);

    if (
      cashEntryAmount.trim() === "" ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      notifyError("Enter a valid amount.");
      return;
    }

    setCashEntryValue(cashEntryType, String(normalizeMoney(amount)));
    setCashEntryAmount("");
    setSaveState({ status: "idle" });
  }

  function editCashEntry(field: CashEntryField) {
    setCashEntryType(field.key);
    setCashEntryAmount(field.value || "0");
  }

  function openCloseoutTab() {
    if (binTicketsSubmitted) {
      setActiveTab("closeout");
      return;
    }

    notifyError("Submit bin end tickets before Daily Closeout.");
  }

  function submitBinEndTickets() {
    if (data.source !== "database") {
      notifyError("Lottery EOD data is not available.");
      return;
    }

    if (reconciliationLocked) {
      notifyError(SAVED_RECONCILIATION_MESSAGE);
      return;
    }

    if (!binsReady) {
      notifyError("Enter valid ending ticket numbers for every active bin.");
      return;
    }

    setSubmittedBinSignature(binSubmissionSignature);
    setActiveTab("closeout");
    setSaveState({ status: "idle" });
    success(
      "Bin end tickets submitted. Starting float, terminal totals, and lottery cash unlocked.",
    );
  }

  const stopNativeDetector = useCallback(() => {
    if (nativeDetectorTimerRef.current !== null) {
      window.clearTimeout(nativeDetectorTimerRef.current);
      nativeDetectorTimerRef.current = null;
    }

    nativeDetectorRef.current = null;
    nativeDetectorBusyRef.current = false;
  }, []);

  const stopScanner = useCallback(
    (message = "Scanner stopped.", clearBin = true) => {
      stopNativeDetector();
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;

      if (scannerVideoRef.current) {
        scannerVideoRef.current.srcObject = null;
      }

      setScannerState("idle");
      setScannerMessage(message);

      if (clearBin) {
        scannerBinNumberRef.current = null;
        setScannerBinNumber(null);
      }
    },
    [stopNativeDetector],
  );

  const selectScannerBin = useCallback((binNumber: number, message: string) => {
    scannerBinNumberRef.current = binNumber;
    setScannerBinNumber(binNumber);
    setScannerMessage(message);
  }, []);

  const receiveScannerBarcode = useCallback(
    (rawBarcode: string) => {
      const parsed = parseScannedTicketBarcode(rawBarcode);
      const selectedBinNumber = scannerBinNumberRef.current;
      const targetBin =
        activeBinsRef.current.find(
          (bin) => bin.binNumber === selectedBinNumber,
        ) ?? null;

      if (!targetBin) {
        setScannerMessage("Choose a bin before scanning.");
        return;
      }

      if (!parsed) {
        setScannerMessage(
          "Barcode not recognized. Use the long ticket barcode.",
        );
        return;
      }

      const now = Date.now();
      const recentScan = recentScanRef.current;

      if (
        recentScan?.barcode === parsed.barcode &&
        now - recentScan.scannedAt < RECENT_SCAN_COOLDOWN_MS
      ) {
        return;
      }

      recentScanRef.current = {
        barcode: parsed.barcode,
        scannedAt: now,
      };

      if (targetBin.gameId && parsed.gameId !== targetBin.gameId) {
        setScannerMessage(
          `Scanned game ${parsed.gameId}, but bin ${targetBin.binNumber} has game ${targetBin.gameId}.`,
        );
        return;
      }

      if (targetBin.packNumber && parsed.packNumber !== targetBin.packNumber) {
        setScannerMessage(
          `Scanned pack ${parsed.packNumber}, but bin ${targetBin.binNumber} has pack ${targetBin.packNumber}.`,
        );
        return;
      }

      setBinInputs((current) => ({
        ...current,
        [targetBin.binNumber]: parsed.ticketNumber,
      }));
      const nextBinNumber = getAdjacentBinNumber(
        activeBinsRef.current,
        targetBin.binNumber,
        "next",
      );
      success(
        `Bin ${targetBin.binNumber} end ticket set to ${parsed.ticketNumber}.`,
      );

      if (nextBinNumber) {
        scannerBinNumberRef.current = nextBinNumber;
        setScannerBinNumber(nextBinNumber);
        setScannerMessage(
          `Bin ${targetBin.binNumber} set to ${parsed.ticketNumber}. Ready for bin ${nextBinNumber}.`,
        );
        return;
      }

      setScannerMessage(
        `Bin ${targetBin.binNumber} set to ${parsed.ticketNumber}. All active bins are done.`,
      );
    },
    [success],
  );

  const startNativeDetector = useCallback(async () => {
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

    nativeDetectorRef.current = new Detector({ formats });

    const scanVideo = async () => {
      const detector = nativeDetectorRef.current;
      const video = scannerVideoRef.current;

      if (!detector || !video) {
        return;
      }

      if (video.readyState >= 2 && !nativeDetectorBusyRef.current) {
        nativeDetectorBusyRef.current = true;

        try {
          const detections = await detector.detect(video);
          const detection = detections.find((item) => item.rawValue);

          if (detection?.rawValue) {
            receiveScannerBarcode(detection.rawValue);
          }
        } catch {
          stopNativeDetector();
          return;
        } finally {
          nativeDetectorBusyRef.current = false;
        }
      }

      if (nativeDetectorRef.current) {
        nativeDetectorTimerRef.current = window.setTimeout(scanVideo, 180);
      }
    };

    nativeDetectorTimerRef.current = window.setTimeout(scanVideo, 180);
    return true;
  }, [receiveScannerBarcode, stopNativeDetector]);

  const startScanner = useCallback(
    async (binNumber: number) => {
      const insecureCameraMessage = getInsecureCameraMessage();

      stopScanner("Starting scanner.", false);
      scannerBinNumberRef.current = binNumber;
      setScannerBinNumber(binNumber);
      recentScanRef.current = null;

      if (insecureCameraMessage) {
        setScannerState("unsupported");
        setScannerMessage(insecureCameraMessage);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerState("unsupported");
        setScannerMessage("Camera access is not available in this browser.");
        return;
      }

      setScannerState("starting");
      setScannerMessage(`Starting scanner for bin ${binNumber}.`);

      try {
        await waitForNextFrame();

        const video = scannerVideoRef.current;

        if (!video) {
          throw new Error("Scanner preview is not ready.");
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

            if (barcode) {
              receiveScannerBarcode(barcode);
            }
          },
        );

        scannerControlsRef.current = controls;
        const nativeDetectorStarted = await startNativeDetector();
        const cameraTuned = await applyMobileCameraTuning(video);

        setScannerMessage(
          nativeDetectorStarted
            ? "Android scanner is on. Hold the long ticket barcode in frame."
            : cameraTuned
              ? "Camera focus is on. Hold the long ticket barcode in frame."
              : "Scanner active. Hold the long ticket barcode in frame.",
        );
        setScannerState("active");
      } catch (error) {
        setScannerState("error");
        setScannerMessage(getCameraErrorMessage(error));
      }
    },
    [receiveScannerBarcode, startNativeDetector, stopScanner],
  );

  const handleScannerBinSelect = useCallback(
    (binNumber: number) => {
      if (scannerState === "active" || scannerState === "starting") {
        selectScannerBin(
          binNumber,
          scannerState === "starting"
            ? `Switching scanner to bin ${binNumber}.`
            : `Ready for bin ${binNumber}.`,
        );
        return;
      }

      void startScanner(binNumber);
    },
    [scannerState, selectScannerBin, startScanner],
  );

  useEffect(() => {
    activeBinsRef.current = activeBins;
  }, [activeBins]);

  useEffect(() => {
    if (shouldLockSavedReconciliation && !reconciliationLocked) {
      setReconciliationLocked(true);
      setSaveState(getSavedReconciliationState());
    }
  }, [reconciliationLocked, shouldLockSavedReconciliation]);

  useEffect(() => {
    if (loadedBusinessDateRef.current === data.businessDate) {
      return;
    }

    loadedBusinessDateRef.current = data.businessDate;
    stopScanner("Scanner stopped.");
    setBinInputs(buildInitialBinInputs(activeBins));
    setSubmittedBinSignature(null);
    setTerminalSales(String(data.terminalSales || ""));
    setTicketCancels(String(data.ticketCancels || ""));
    setCashingBonus(String(data.cashingBonus || ""));
    setLotteryBondFee(String(data.lotteryBondFee || ""));
    setOnlineTotalPayout(String(data.onlineTotalPayout || ""));
    setScratchCardTotalPayout(String(data.scratchCardTotalPayout || ""));
    setStartingFloat(String(data.startingFloat || ""));
    setTillCash(String(data.tillCash || ""));
    setActiveTab("log");
    setCashEntryType("startingFloat");
    setCashEntryAmount("");
    setManagerNotes(data.managerNotes);
    const nextLocked = data.isReconciled && !canSelectDate;
    setReconciliationLocked(nextLocked);
    setSaveState(
      nextLocked ? getSavedReconciliationState() : { status: "idle" },
    );
  }, [
    activeBins,
    canSelectDate,
    data.businessDate,
    data.cashingBonus,
    data.isReconciled,
    data.lotteryBondFee,
    data.managerNotes,
    data.onlineTotalPayout,
    data.scratchCardTotalPayout,
    data.startingFloat,
    data.terminalSales,
    data.ticketCancels,
    data.tillCash,
    stopScanner,
  ]);

  useEffect(() => {
    if (
      !reconciliationLocked &&
      submittedBinSignature !== null &&
      submittedBinSignature !== binSubmissionSignature
    ) {
      setActiveTab("log");
      setSaveState({ status: "idle" });
    }
  }, [binSubmissionSignature, reconciliationLocked, submittedBinSignature]);

  useEffect(
    () => () => {
      stopScanner("Scanner stopped.");
    },
    [stopScanner],
  );

  async function saveReconciliation() {
    if (!binsReady) {
      notifyError("Enter valid ending ticket numbers for every active bin.");
      return;
    }

    if (!binTicketsSubmitted) {
      notifyError("Submit bin end tickets before terminal and cash closeout.");
      return;
    }

    if (reconciliationLocked) {
      notifyError(SAVED_RECONCILIATION_MESSAGE);
      return;
    }

    if (!canSave) {
      notifyError("Reconciliation is not ready to save.");
      return;
    }

    setSaveState({ status: "saving" });

    try {
      const response = await fetch("/api/lottery/eod-reconciliation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          binEntries: binCalculations.map(({ bin, calculation }) => ({
            binNumber: bin.binNumber,
            endTicketNumber: calculation.endTicketNumber,
          })),
          cashingBonus,
          date: data.businessDate,
          lotteryBondFee,
          managerNotes,
          onlineTotalPayout,
          scratchCardTotalPayout,
          startingFloat,
          terminalSales,
          ticketCancels,
          tillCash,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Reconciliation could not be saved");
      }

      setSaveState({
        status: "saved",
        message: `${payload.discrepancyStatus} ${formatCurrency(
          Math.abs(Number(payload.shortOverAmount ?? 0)),
        )}`,
      });
      setReconciliationLocked(!canSelectDate);
      success("Lottery EOD reconciliation saved.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Reconciliation could not be saved";

      if (
        message.startsWith(
          "Lottery EOD reconciliation is already saved for this date",
        )
      ) {
        setReconciliationLocked(true);
        setSaveState(getSavedReconciliationState());
        notifyError(message);
        return;
      }

      setSaveState({ status: "error", message });
      notifyError(message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-satoshi text-3xl font-bold text-dark dark:text-white">
            Lottery EOD Desk
          </h1>
          <p className="font-satoshi mt-2 text-gray-6">
            Reconcile scratch bins, starting float, terminal totals, payouts,
            and lottery cash
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-dark-5">
            {canSelectDate ? "Select Date" : "Today Only"}
          </label>
          <input
            type="date"
            value={data.businessDate}
            max={todayDate}
            onChange={(event) => changeSelectedDate(event.target.value)}
            disabled={!canSelectDate}
            className="rounded-lg border border-stroke bg-white px-3 py-1.5 text-sm font-bold text-dark outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-gray-1 disabled:text-dark-5 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:disabled:bg-dark-3 dark:disabled:text-dark-6"
          />
        </div>
      </div>

      <div className="flex justify-center sm:justify-start">
        <div className="flex gap-2 rounded-full border border-stroke bg-white p-1 shadow-sm dark:border-dark-3 dark:bg-dark-2">
          <button
            type="button"
            onClick={() => setActiveTab("log")}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all ${
              activeTab === "log"
                ? "bg-primary text-white shadow-lg"
                : "text-dark-5 hover:bg-gray-2 dark:hover:bg-dark-3"
            }`}
          >
            <Receipt className="h-4 w-4" />
            Log Totals
          </button>
          <button
            type="button"
            onClick={openCloseoutTab}
            className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all ${
              activeTab === "closeout"
                ? "bg-primary text-white shadow-lg"
                : !binTicketsSubmitted
                  ? "cursor-not-allowed text-gray-4 opacity-50"
                  : "text-dark-5 hover:bg-gray-2 dark:hover:bg-dark-3"
            }`}
          >
            {binTicketsSubmitted ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            Daily Closeout
          </button>
        </div>
      </div>

      {data.source !== "database" ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {data.source === "unconfigured"
            ? "Supabase is not configured."
            : data.errorMessage}
        </div>
      ) : null}

      {reconciliationLocked ? (
        <div className="flex items-center gap-3 rounded-lg border border-green/20 bg-green/5 px-4 py-3 text-sm font-semibold text-green">
          <Lock className="h-5 w-5 shrink-0" />
          <span>
            Lottery EOD reconciliation is already saved for this date.
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Scratch sales"
          value={formatCurrency(scratchSalesTotal)}
          detail={`${activeBins.length} active bins`}
          icon={<Ticket className="h-5 w-5" />}
          tone="green"
        />
        <SummaryCard
          label="Terminal sales"
          value={formatCurrency(terminalSalesTotal)}
          detail="Draw sales entered below"
          icon={<Receipt className="h-5 w-5" />}
          tone="blue"
        />
        <SummaryCard
          label="Expected cash"
          value={formatCurrency(totalExpectedCash)}
          detail="Advances excluded"
          icon={<Calculator className="h-5 w-5" />}
          tone="slate"
        />
        <SummaryCard
          label="Short / over"
          value={formatCurrency(Math.abs(shortOver))}
          detail={shortOverStatus.label}
          icon={<Wallet className="h-5 w-5" />}
          tone={shortOverStatus.tone === "red" ? "red" : "green"}
        />
      </div>

      {activeTab === "log" ? (
        <div className="animate-fade-in">
          <div className="rounded-[28px] border border-stroke bg-white p-8 shadow-sm dark:border-dark-3 dark:bg-dark-2">
            <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-satoshi flex items-center gap-3 text-2xl font-bold text-dark dark:text-white">
                  <Ticket className="h-6 w-6 text-primary" />
                  Bin end tickets
                </h2>
                <p className="mt-1 text-sm text-dark-5">
                  Keep the camera open while walking bin to bin.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="blue">
                  {activeBins.length} active
                </StatusBadge>
                <StatusBadge tone={binSubmissionStatus.tone}>
                  {binSubmissionStatus.label}
                </StatusBadge>
                {scannerState === "active" || scannerState === "starting" ? (
                  <button
                    type="button"
                    onClick={() => stopScanner()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-stroke px-3 py-2 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-white"
                  >
                    <CameraOff className="h-4 w-4" />
                    Stop camera
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const firstBinNumber =
                        scannerBinNumber ?? getFirstBinNumber(activeBins);

                      if (firstBinNumber) {
                        void startScanner(firstBinNumber);
                      }
                    }}
                    disabled={activeBins.length === 0 || reconciliationLocked}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ScanLine className="h-4 w-4" />
                    Start walking scan
                  </button>
                )}
              </div>
            </div>

            {scannerBin ? (
              <div className="mb-5 overflow-hidden rounded-2xl border border-primary/15 bg-slate-950 shadow-sm">
                <div className="relative h-[150px] bg-slate-950 sm:h-[190px] lg:h-[220px]">
                  <video
                    ref={scannerVideoRef}
                    muted
                    playsInline
                    className="block h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.25),transparent_30%,transparent_70%,rgba(2,6,23,0.35))]" />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3">
                    <div className="relative h-14 w-full max-w-[36rem] rounded-lg border-2 border-primary/85 shadow-[0_0_0_999px_rgba(2,6,23,0.24)] sm:h-16">
                      <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-primary/85 shadow-[0_0_18px_rgba(62,80,255,0.75)]" />
                    </div>
                  </div>
                  <div className="absolute left-3 top-3">
                    <StatusBadge
                      tone={
                        scannerState === "active"
                          ? "green"
                          : scannerState === "error" ||
                              scannerState === "unsupported"
                            ? "red"
                            : "blue"
                      }
                      className="capitalize"
                    >
                      Bin {scannerBin.binNumber} {scannerState}
                    </StatusBadge>
                  </div>
                </div>
                <div className="flex flex-col gap-3 border-t border-white/10 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-xs text-slate-300">
                    <div className="font-semibold text-white">
                      Ready for Bin {scannerBin.binNumber}
                    </div>
                    <div className="mt-0.5 truncate">
                      {scannerBin.gameName} / Pack {scannerBin.packNumber}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-white">
                      <ScanLine className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0">{scannerMessage}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        previousScannerBinNumber
                          ? selectScannerBin(
                              previousScannerBinNumber,
                              `Ready for bin ${previousScannerBinNumber}.`,
                            )
                          : undefined
                      }
                      disabled={!previousScannerBinNumber}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        nextScannerBinNumber
                          ? selectScannerBin(
                              nextScannerBinNumber,
                              `Ready for bin ${nextScannerBinNumber}.`,
                            )
                          : undefined
                      }
                      disabled={!nextScannerBinNumber}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    {scannerState === "active" ||
                    scannerState === "starting" ? (
                      <button
                        type="button"
                        onClick={() => stopScanner()}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
                      >
                        <CameraOff className="h-4 w-4" />
                        Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void startScanner(scannerBin.binNumber)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
                      >
                        <ScanLine className="h-4 w-4" />
                        Start
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {activeBins.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bin</TableHead>
                        <TableHead>Game</TableHead>
                        <TableHead>Start</TableHead>
                        <TableHead>End ticket</TableHead>
                        <TableHead className="text-right">Sales</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {binCalculations.map(({ bin, calculation }) => (
                        <TableRow
                          key={bin.binNumber}
                          className={
                            scannerBinNumber === bin.binNumber
                              ? "bg-primary/5"
                              : ""
                          }
                        >
                          <TableCell>
                            <div className="font-semibold text-dark dark:text-white">
                              Bin {bin.binNumber}
                            </div>
                            <div className="mt-0.5 font-mono text-xs text-dark-5">
                              {bin.packNumber}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-dark dark:text-white">
                              {bin.gameName}
                            </div>
                            <div className="mt-0.5 text-xs text-dark-5">
                              {formatCurrency(bin.ticketPrice)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-mono font-semibold text-dark dark:text-white">
                              {calculation.resetApplied
                                ? "000"
                                : bin.lastTicketNumber}
                            </div>
                            {bin.canResetTicketNumber ? (
                              <div className="mt-1">
                                <StatusBadge tone="blue">
                                  Reset ready
                                </StatusBadge>
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex min-w-44 items-start gap-2">
                              <div className="min-w-0">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={binInputs[bin.binNumber] ?? ""}
                                  disabled={reconciliationLocked}
                                  onChange={(event) =>
                                    setBinInputs((current) => ({
                                      ...current,
                                      [bin.binNumber]: normalizeTicketInput(
                                        event.target.value,
                                      ),
                                    }))
                                  }
                                  className={`w-24 rounded-xl border-2 bg-transparent px-3 py-2 text-center font-mono text-lg font-bold text-dark outline-none transition focus:border-primary dark:text-white ${
                                    !calculation.isValid
                                      ? "border-red/40"
                                      : "border-stroke dark:border-dark-3"
                                  }`}
                                  placeholder="000"
                                />
                                {!calculation.isValid ? (
                                  <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-red">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    Check end
                                  </div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleScannerBinSelect(bin.binNumber)
                                }
                                disabled={
                                  reconciliationLocked ||
                                  scannerState === "starting"
                                }
                                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stroke text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3"
                                aria-label={`Scan bin ${bin.binNumber} end ticket`}
                                title={`Scan bin ${bin.binNumber} end ticket`}
                              >
                                {scannerState === "starting" &&
                                scannerBinNumber === bin.binNumber ? (
                                  <LoaderCircle className="h-5 w-5 animate-spin" />
                                ) : (
                                  <ScanLine className="h-5 w-5" />
                                )}
                              </button>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-semibold text-dark dark:text-white">
                              {formatCurrency(calculation.sales)}
                            </div>
                            <div className="mt-0.5 text-xs text-dark-5">
                              {calculation.ticketsSold} tickets
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-5 flex flex-col gap-3 border-t border-stroke pt-4 dark:border-dark-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-dark-5">
                    Scratch sales after bin ticket entries:{" "}
                    <span className="font-bold text-dark dark:text-white">
                      {formatCurrency(scratchSalesTotal)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={submitBinEndTickets}
                    disabled={
                      data.source !== "database" ||
                      !binsReady ||
                      reconciliationLocked ||
                      binTicketsSubmitted
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black uppercase tracking-wider text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {binTicketsSubmitted ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {binTicketsSubmitted
                      ? "Bin tickets submitted"
                      : "Submit bin end tickets"}
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-stroke px-4 py-10 text-center text-sm text-dark-5">
                No active lottery bins.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="animate-fade-in grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="rounded-[28px] border border-stroke bg-white p-8 shadow-sm dark:border-dark-3 dark:bg-dark-2">
            <h2 className="font-satoshi mb-8 flex items-center gap-3 text-2xl font-bold text-dark dark:text-white">
              <Wallet className="h-6 w-6 text-primary" />
              Lottery Cash Reconciliation
            </h2>

            {binTicketsSubmitted ? (
              <div className="space-y-8">
                <form
                  onSubmit={submitCashEntry}
                  className="rounded-2xl border border-primary/10 bg-primary/5 p-6"
                >
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                        Select total
                      </span>
                      <select
                        value={cashEntryType}
                        onChange={(event) => {
                          setCashEntryType(event.target.value as CashEntryKey);
                          setCashEntryAmount("");
                        }}
                        className="w-full rounded-xl border-2 border-stroke bg-white px-4 py-3 text-lg font-bold text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:bg-dark-3 dark:text-white"
                      >
                        {cashEntryFields.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                        Amount
                      </span>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
                        <CurrencyInput
                          value={cashEntryAmount}
                          showSymbol={false}
                          disabled={reconciliationLocked}
                          onValueChange={(decimalValue) =>
                            setCashEntryAmount(decimalValue)
                          }
                          className="w-full rounded-xl border-2 border-stroke bg-white py-3 pl-10 pr-4 text-xl font-bold text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:bg-dark-3 dark:text-white"
                          placeholder={
                            selectedCashEntry
                              ? selectedCashEntry.amount.toFixed(2)
                              : "0.00"
                          }
                        />
                      </div>
                    </label>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:flex-col xl:items-stretch 2xl:flex-row 2xl:items-center">
                    <p className="text-xs font-semibold text-primary/70">
                      {selectedCashEntry?.description}
                    </p>
                    <button
                      type="submit"
                      disabled={
                        data.source !== "database" || reconciliationLocked
                      }
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black uppercase tracking-wider text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      Set amount
                    </button>
                  </div>
                </form>

                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                      Entered totals
                    </p>
                    <p className="text-xs font-semibold text-dark-5">
                      Click any row to edit
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-stroke bg-white dark:border-dark-3 dark:bg-dark-3">
                    <div className="divide-y divide-stroke dark:divide-dark-2">
                      {cashEntryFields.map((field) => (
                        <button
                          key={field.key}
                          type="button"
                          onClick={() => editCashEntry(field)}
                          disabled={reconciliationLocked}
                          className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-gray-1 dark:hover:bg-dark-2 ${
                            field.key === "startingFloat" ||
                            field.key === "tillCash"
                              ? "bg-primary/5"
                              : ""
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-dark dark:text-white">
                              {field.label}
                            </span>
                            <span className="block truncate text-xs text-dark-5">
                              {field.description}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-base font-black text-dark dark:text-white">
                            {formatCurrency(field.amount)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                    Notes &amp; Discrepancy Explanation
                  </span>
                  <textarea
                    value={managerNotes}
                    disabled={reconciliationLocked}
                    onChange={(event) => setManagerNotes(event.target.value)}
                    rows={3}
                    className="w-full rounded-xl border-2 border-stroke bg-transparent px-4 py-3 text-dark outline-none transition-all focus:border-primary dark:border-dark-3 dark:text-white"
                    placeholder="Explain variance or payout details..."
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-primary">
                  <Lock className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold">
                      Bin end tickets required
                    </p>
                    <p className="text-xs opacity-80">
                      Submit bin end tickets before starting float, terminal
                      totals, payouts, PROMO, bond fee, and cash counted are
                      available.
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl border border-dashed border-stroke bg-gray-1/50 px-5 py-8 text-center dark:border-dark-3 dark:bg-dark-3/40">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white text-dark-5 shadow-sm dark:bg-dark-2 dark:text-dark-6">
                    <Lock className="h-5 w-5" />
                  </div>
                  <h3 className="font-satoshi mt-4 text-lg font-bold text-dark dark:text-white">
                    Lottery cash closeout locked
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-sm text-dark-5">
                    Finish the bin count first so scratch sales are locked into
                    the expected cash calculation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={submitBinEndTickets}
                  disabled={
                    data.source !== "database" ||
                    !binsReady ||
                    reconciliationLocked
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 text-sm font-black uppercase tracking-wider text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  Submit bin end tickets
                </button>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-stroke bg-white p-8 shadow-sm dark:border-dark-3 dark:bg-dark-2">
              <h2 className="font-satoshi mb-6 flex items-center gap-2 text-xl font-bold text-dark dark:text-white">
                <Calculator className="h-5 w-5 text-primary" />
                System Calculations
              </h2>
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-dark-5">Starting float</span>
                  <span className="font-bold text-green">
                    +{formatCurrency(startingFloatTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-dark-5">Scratch sales</span>
                  <span className="font-bold text-green">
                    +{formatCurrency(scratchSalesTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-dark-5">Terminal sales</span>
                  <span className="font-bold text-green">
                    +{formatCurrency(terminalSalesTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-dark-5">Deductions</span>
                  <span className="font-bold text-red">
                    -{formatCurrency(totalDeductions)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-dark-5">
                    Lottery cash advances (tracked only)
                  </span>
                  <span
                    className={`font-bold ${
                      lotteryCashAdvanceNetImpact < 0
                        ? "text-red"
                        : lotteryCashAdvanceNetImpact > 0
                          ? "text-green"
                          : "text-dark dark:text-white"
                    }`}
                  >
                    {lotteryCashAdvanceNetImpact > 0 ? "+" : ""}
                    {formatCurrency(lotteryCashAdvanceNetImpact)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-dark-5">Lottery bond fee (EFT)</span>
                  <span className="text-amber font-bold">
                    {formatCurrency(lotteryBondFeeTotal)}
                  </span>
                </div>
                <div className="border-t-2 border-dashed border-stroke pt-4 dark:border-dark-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-bold uppercase tracking-wider text-dark dark:text-white">
                      Expected cash
                    </span>
                    <span className="text-2xl font-black text-dark dark:text-white">
                      {formatCurrency(totalExpectedCash)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-dark-5">Cash counted in drawer</span>
                  <span className="font-bold text-dark dark:text-white">
                    {formatCurrency(tillCashTotal)}
                  </span>
                </div>
              </div>
            </div>

            <div
              className={`rounded-[28px] border-2 p-8 transition-all ${
                shortOver === 0
                  ? "border-green/20 bg-green/5"
                  : Math.abs(shortOver) < 10
                    ? "border-amber/20 bg-amber/5"
                    : "border-red/20 bg-red/5"
              }`}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3
                    className={`text-lg font-bold ${
                      shortOver === 0
                        ? "text-green"
                        : Math.abs(shortOver) < 10
                          ? "text-amber"
                          : "text-red"
                    }`}
                  >
                    {shortOver === 0
                      ? "Perfect Reconciliation"
                      : "Lottery Cash Variance Detected"}
                  </h3>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Difference between counted lottery drawer cash and system
                    expectation.
                  </p>
                </div>
                {shortOver === 0 ? (
                  <CheckCircle2 className="h-8 w-8 shrink-0 text-green" />
                ) : (
                  <AlertTriangle className="h-8 w-8 shrink-0 text-red" />
                )}
              </div>

              <div className="flex items-baseline gap-2">
                <span
                  className={`text-4xl font-black ${
                    shortOver === 0
                      ? "text-green"
                      : Math.abs(shortOver) < 10
                        ? "text-amber"
                        : "text-red"
                  }`}
                >
                  {formatCurrency(Math.abs(shortOver))}
                </span>
                <span className="text-xs font-bold uppercase tracking-widest text-dark-6">
                  {shortOverStatus.label}
                </span>
              </div>

              {Math.abs(shortOver) > 0 ? (
                <div className="mt-6 rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark-3">
                  <p className="mb-2 text-xs font-bold uppercase text-dark dark:text-white">
                    Action Required:
                  </p>
                  <p className="text-xs leading-relaxed text-dark-5 dark:text-dark-6">
                    Double-check starting float, terminal totals, payouts,
                    PROMO, and counted lottery cash. If the variance remains,
                    leave a note before saving.
                  </p>
                </div>
              ) : null}

              {saveState.message ? (
                <div
                  className={`mt-6 rounded-xl px-3 py-2 text-sm font-semibold ${
                    saveState.status === "error"
                      ? "bg-red/10 text-red"
                      : "bg-green/10 text-green"
                  }`}
                >
                  {saveState.message}
                </div>
              ) : null}

              <button
                type="button"
                disabled={!canSave}
                onClick={() => void saveReconciliation()}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-dark py-4 font-black uppercase tracking-widest text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-dark"
              >
                {saveState.status === "saving" ? (
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                ) : saveState.status === "saved" || reconciliationLocked ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <Save className="h-5 w-5" />
                )}
                {reconciliationLocked
                  ? "Reconciliation saved"
                  : "Save reconciliation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
