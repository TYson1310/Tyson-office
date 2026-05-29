"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  DollarSign,
  Loader2,
  Plus,
  RefreshCcw,
  Wallet,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/erp/status-badge";
import { CurrencyInput } from "@/components/ui/currency-input";
import { VendorModal } from "@/components/vendors/vendor-modal";
import { useAppNotifications } from "@/contexts/NotificationContext";
import type { LotteryCashAdvanceRecord } from "@/lib/lottery/cash-advances";

type LotteryCashAdvancesPanelProps = {
  available: boolean;
  businessDate: string;
  dailyAdvanceTotal: number;
  dailyNetCashImpact: number;
  dailyPaybackTotal: number;
  disabled?: boolean;
  openAdvanceBalance: number;
  openAdvances: LotteryCashAdvanceRecord[];
  warning?: string;
};

type ModalState =
  | { type: "advance" }
  | { advance: LotteryCashAdvanceRecord; type: "payback" }
  | null;

const INPUT_CLASSNAME = "app-input";
const TEXTAREA_CLASSNAME = `${INPUT_CLASSNAME} min-h-24 resize-y`;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatDate(value: string | undefined) {
  if (!value) {
    return "-";
  }

  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}

function getStatusTone(status: LotteryCashAdvanceRecord["status"]) {
  if (status === "paid") {
    return "green" as const;
  }

  if (status === "partial") {
    return "amber" as const;
  }

  if (status === "void") {
    return "red" as const;
  }

  return "blue" as const;
}

export function LotteryCashAdvancesPanel({
  available,
  businessDate,
  dailyAdvanceTotal,
  dailyNetCashImpact,
  dailyPaybackTotal,
  disabled = false,
  openAdvanceBalance,
  openAdvances,
  warning,
}: LotteryCashAdvancesPanelProps) {
  const router = useRouter();
  const { error: notifyError, success } = useAppNotifications();
  const [modal, setModal] = useState<ModalState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [personName, setPersonName] = useState("");
  const [advanceDate, setAdvanceDate] = useState(businessDate);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [expectedPaybackDate, setExpectedPaybackDate] = useState(businessDate);
  const [advanceNotes, setAdvanceNotes] = useState("");
  const [paybackAmount, setPaybackAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(businessDate);
  const [paybackNotes, setPaybackNotes] = useState("");
  const netImpactLabel = useMemo(() => {
    if (dailyNetCashImpact === 0) {
      return "$0.00";
    }

    return `${dailyNetCashImpact > 0 ? "+" : "-"}${formatCurrency(
      Math.abs(dailyNetCashImpact),
    )}`;
  }, [dailyNetCashImpact]);

  function resetAdvanceForm() {
    setPersonName("");
    setAdvanceDate(businessDate);
    setAdvanceAmount("");
    setAdvanceReason("");
    setExpectedPaybackDate(businessDate);
    setAdvanceNotes("");
  }

  function resetPaybackForm(advance?: LotteryCashAdvanceRecord) {
    setPaybackAmount(advance ? advance.balance.toFixed(2) : "");
    setPaymentDate(businessDate);
    setPaybackNotes("");
  }

  function closeModal() {
    if (isSubmitting) {
      return;
    }

    setModal(null);
  }

  async function submitAdvance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/lottery/cash-advances", {
        body: JSON.stringify({
          advanceDate,
          amount: advanceAmount,
          expectedPaybackDate,
          notes: advanceNotes,
          personName,
          reason: advanceReason,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Lottery cash advance could not be recorded.",
        );
      }

      success("Lottery cash advance recorded.");
      resetAdvanceForm();
      setModal(null);
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : "Lottery cash advance could not be recorded.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitPayback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (modal?.type !== "payback") {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/lottery/cash-advances", {
        body: JSON.stringify({
          action: "repay",
          amount: paybackAmount,
          id: modal.advance.id,
          notes: paybackNotes,
          paymentDate,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Payback could not be recorded.");
      }

      success("Lottery cash advance payback recorded.");
      resetPaybackForm();
      setModal(null);
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error.message
          : "Payback could not be recorded.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function voidAdvance(advance: LotteryCashAdvanceRecord) {
    if (disabled || !available) {
      return;
    }

    const voidReason = window.prompt(
      `Void lottery cash advance for ${advance.personName}? Enter reason.`,
    );

    if (!voidReason?.trim()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/lottery/cash-advances", {
        body: JSON.stringify({
          action: "void",
          id: advance.id,
          voidReason,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Advance could not be voided.");
      }

      success("Lottery cash advance voided.");
      router.refresh();
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : "Advance could not be voided.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-[28px] border border-stroke bg-white p-8 shadow-sm dark:border-dark-3 dark:bg-dark-2">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-satoshi flex items-center gap-2 text-xl font-bold text-dark dark:text-white">
            <Wallet className="h-5 w-5 text-primary" />
            Lottery Cash Advances
          </h2>
          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
            Temporary lottery drawer cash out and payback tracking.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetAdvanceForm();
            setModal({ type: "advance" });
          }}
          disabled={disabled || !available}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          Record advance
        </button>
      </div>

      {!available ? (
        <div className="border-amber/30 bg-amber/10 text-amber mb-5 rounded-lg border px-4 py-3 text-sm font-semibold">
          {warning ?? "Lottery cash advances are not available."}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-stroke px-4 py-3 dark:border-dark-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-dark-5">
            Taken on date
          </p>
          <p className="mt-2 text-lg font-black text-red">
            -{formatCurrency(dailyAdvanceTotal)}
          </p>
        </div>
        <div className="rounded-2xl border border-stroke px-4 py-3 dark:border-dark-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-dark-5">
            Paid back on date
          </p>
          <p className="mt-2 text-lg font-black text-green">
            +{formatCurrency(dailyPaybackTotal)}
          </p>
        </div>
        <div className="rounded-2xl border border-stroke px-4 py-3 dark:border-dark-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-dark-5">
            Cash impact
          </p>
          <p
            className={`mt-2 text-lg font-black ${
              dailyNetCashImpact < 0
                ? "text-red"
                : dailyNetCashImpact > 0
                  ? "text-green"
                  : "text-dark dark:text-white"
            }`}
          >
            {netImpactLabel}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between rounded-2xl bg-gray-1 px-4 py-3 text-sm dark:bg-dark-3">
        <span className="font-semibold text-dark-5 dark:text-dark-6">
          Outstanding balance
        </span>
        <span className="text-lg font-black text-dark dark:text-white">
          {formatCurrency(openAdvanceBalance)}
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {openAdvances.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stroke px-4 py-6 text-center text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
            No open lottery cash advances.
          </div>
        ) : (
          openAdvances.map((advance) => (
            <div
              key={advance.id}
              className="rounded-2xl border border-stroke p-4 dark:border-dark-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-dark dark:text-white">
                      {advance.personName}
                    </p>
                    <StatusBadge tone={getStatusTone(advance.status)}>
                      {advance.status}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {advance.reason}
                  </p>
                  <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                    Taken {formatDate(advance.advanceDate)}
                    {advance.expectedPaybackDate
                      ? ` / Due ${formatDate(advance.expectedPaybackDate)}`
                      : ""}
                  </p>
                </div>
                <div className="shrink-0 text-left sm:text-right">
                  <p className="text-lg font-black text-dark dark:text-white">
                    {formatCurrency(advance.balance)}
                  </p>
                  <p className="text-xs text-dark-5 dark:text-dark-6">
                    of {formatCurrency(advance.amount)}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    resetPaybackForm(advance);
                    setModal({ advance, type: "payback" });
                  }}
                  disabled={disabled || !available || isSubmitting}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-green px-3 py-2 text-xs font-bold text-white transition hover:bg-green/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Pay back
                </button>
                <button
                  type="button"
                  onClick={() => void voidAdvance(advance)}
                  disabled={disabled || !available || isSubmitting}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-red/30 px-3 py-2 text-xs font-bold text-red transition hover:bg-red/5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Ban className="h-3.5 w-3.5" />
                  Void
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {modal ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-2xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h3 className="text-xl font-semibold text-dark dark:text-white">
                    {modal.type === "advance"
                      ? "Record lottery cash advance"
                      : "Record cash payback"}
                  </h3>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {modal.type === "advance"
                      ? `This will reduce expected lottery cash for ${formatDate(
                          advanceDate,
                        )}.`
                      : `Outstanding balance: ${formatCurrency(
                          modal.advance.balance,
                        )}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="app-icon-button"
                  aria-label="Close lottery cash advance dialog"
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {modal.type === "advance" ? (
                <form onSubmit={submitAdvance} className="space-y-4 px-6 py-6">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Authorized Person
                    </span>
                    <input
                      required
                      className={INPUT_CLASSNAME}
                      value={personName}
                      onChange={(event) => setPersonName(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Amount
                    </span>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
                      <CurrencyInput
                        required
                        className={`${INPUT_CLASSNAME} pl-9`}
                        value={advanceAmount}
                        onValueChange={(value) => setAdvanceAmount(value)}
                        showSymbol={false}
                        disabled={isSubmitting}
                        placeholder="0.00"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Advance Date
                    </span>
                    <input
                      type="date"
                      required
                      className={INPUT_CLASSNAME}
                      value={advanceDate}
                      onChange={(event) => {
                        setAdvanceDate(event.target.value);

                        if (
                          expectedPaybackDate &&
                          event.target.value > expectedPaybackDate
                        ) {
                          setExpectedPaybackDate(event.target.value);
                        }
                      }}
                      disabled={isSubmitting}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Reason
                    </span>
                    <input
                      required
                      className={INPUT_CLASSNAME}
                      value={advanceReason}
                      onChange={(event) => setAdvanceReason(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Expected Payback Date
                    </span>
                    <input
                      type="date"
                      className={INPUT_CLASSNAME}
                      value={expectedPaybackDate}
                      min={advanceDate}
                      onChange={(event) =>
                        setExpectedPaybackDate(event.target.value)
                      }
                      disabled={isSubmitting}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Notes
                    </span>
                    <textarea
                      className={TEXTAREA_CLASSNAME}
                      value={advanceNotes}
                      onChange={(event) => setAdvanceNotes(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </label>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={isSubmitting}
                      className="flex-1 rounded-full border border-stroke py-3 text-sm font-bold text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 rounded-full bg-primary py-3 text-sm font-bold text-white transition hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </span>
                      ) : (
                        "Save Advance"
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={submitPayback} className="space-y-4 px-6 py-6">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Payback Amount
                    </span>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
                      <CurrencyInput
                        required
                        className={`${INPUT_CLASSNAME} pl-9`}
                        value={paybackAmount}
                        onValueChange={(value) => setPaybackAmount(value)}
                        showSymbol={false}
                        disabled={isSubmitting}
                        placeholder="0.00"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Payback Date
                    </span>
                    <input
                      type="date"
                      required
                      className={INPUT_CLASSNAME}
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Notes
                    </span>
                    <textarea
                      className={TEXTAREA_CLASSNAME}
                      value={paybackNotes}
                      onChange={(event) => setPaybackNotes(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </label>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={isSubmitting}
                      className="flex-1 rounded-full border border-stroke py-3 text-sm font-bold text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 rounded-full bg-green py-3 text-sm font-bold text-white transition hover:bg-green/90 disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </span>
                      ) : (
                        "Save Payback"
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </VendorModal>
      ) : null}
    </div>
  );
}
