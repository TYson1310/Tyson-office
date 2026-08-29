"use client";

import { useEffect, useState, type FormEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Loader2, X, Upload } from "lucide-react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { VendorModal } from "@/components/vendors/vendor-modal";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";

const INPUT_CLASSNAME = "app-input";
const TEXTAREA_CLASSNAME = `${INPUT_CLASSNAME} min-h-24 resize-y`;

export type BankDepositCashSource = "store_till" | "lottery_till";

const CASH_SOURCE_OPTIONS: Array<{
  value: BankDepositCashSource;
  label: string;
  description: string;
}> = [
  {
    value: "store_till",
    label: "Store cash",
    description: "Regular register and cash vault funds.",
  },
  {
    value: "lottery_till",
    label: "Lottery cash",
    description: "Lottery drawer cash in hand.",
  },
];

function formatDefaultAmount(value?: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(2)
    : "";
}

export function MakeDepositButton({
  buttonLabel = "Make Deposit",
  defaultAmount,
  defaultCashSource = "store_till",
  disabled = false,
  lockCashSource = false,
  storeKey,
  timeZone,
}: {
  buttonLabel?: string;
  defaultAmount?: number;
  defaultCashSource?: BankDepositCashSource;
  disabled?: boolean;
  lockCashSource?: boolean;
  storeKey: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(() =>
    formatDefaultAmount(defaultAmount),
  );
  const [cashSource, setCashSource] =
    useState<BankDepositCashSource>(defaultCashSource);
  const [depositDate, setDepositDate] = useState(() =>
    getTodayIsoDateInTimeZone(timeZone),
  );
  const [notes, setNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const resetForm = () => {
    setAmount(formatDefaultAmount(defaultAmount));
    setCashSource(defaultCashSource);
    setDepositDate(getTodayIsoDateInTimeZone(timeZone));
    setNotes("");
    setSelectedFile(null);
    setError("");
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDepositDate(getTodayIsoDateInTimeZone(timeZone));
  }, [isOpen, timeZone]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const depositAmount = parseFloat(amount);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        throw new Error("Please enter a valid amount greater than zero.");
      }

      if (!depositDate) {
        throw new Error("Please select the deposit date.");
      }

      if (!storeKey) {
        throw new Error("Select a store before recording a deposit.");
      }

      const formData = new FormData();
      formData.set("amount", String(depositAmount));
      formData.set("cashSource", cashSource);
      formData.set("depositDate", depositDate);
      formData.set("notes", notes.trim());

      if (selectedFile) {
        formData.set("slip", selectedFile);
      }

      const response = await fetch("/api/bank-deposits", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to record bank deposit.");
      }

      setIsOpen(false);
      resetForm();
      router.refresh();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetForm();
          setIsOpen(true);
        }}
        disabled={disabled}
        className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Landmark className="h-4 w-4" />
        {buttonLabel}
      </button>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-2xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Record bank deposit
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Log a cash transfer to the bank and attach the deposit slip
                    if available.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !isSubmitting && setIsOpen(false)}
                  className="app-icon-button"
                  aria-label="Close bank deposit dialog"
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-6">
                <div className="space-y-4">
                  {error ? (
                    <div className="rounded-lg bg-red/10 p-3 text-sm text-red">
                      {error}
                    </div>
                  ) : null}

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Deposit Amount
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-5">
                        $
                      </span>
                      <CurrencyInput
                        required
                        placeholder="0.00"
                        className={`${INPUT_CLASSNAME} pl-8`}
                        value={amount}
                        onValueChange={(decimalValue) =>
                          setAmount(decimalValue)
                        }
                        showSymbol={false}
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Cash Source
                    </label>
                    <select
                      required
                      className={INPUT_CLASSNAME}
                      value={cashSource}
                      onChange={(e) =>
                        setCashSource(e.target.value as BankDepositCashSource)
                      }
                      disabled={isSubmitting || lockCashSource}
                    >
                      {CASH_SOURCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                      {
                        CASH_SOURCE_OPTIONS.find(
                          (option) => option.value === cashSource,
                        )?.description
                      }
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Deposit Date
                    </label>
                    <input
                      type="date"
                      required
                      className={INPUT_CLASSNAME}
                      value={depositDate}
                      onChange={(e) => setDepositDate(e.target.value)}
                      disabled={isSubmitting}
                    />
                    <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                      Stored using the store timezone: {timeZone}
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Bank Slip Photo
                    </label>
                    <div className="flex items-center gap-4">
                      <label className="flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-stroke bg-gray-2 py-6 transition hover:border-primary dark:border-dark-3 dark:bg-dark-2">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          {selectedFile ? (
                            <Landmark className="h-8 w-8 text-primary" />
                          ) : (
                            <Upload className="h-8 w-8 text-dark-5" />
                          )}
                          <p className="text-xs text-dark-5">
                            {selectedFile
                              ? selectedFile.name
                              : "Click to upload slip photo"}
                          </p>
                        </div>
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={handleFileChange}
                          disabled={isSubmitting}
                        />
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Notes
                    </label>
                    <textarea
                      placeholder="Optional deposit details..."
                      className={TEXTAREA_CLASSNAME}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="mt-8 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    disabled={isSubmitting}
                    className="flex-1 rounded-full border border-stroke py-3 text-sm font-bold text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 rounded-full bg-emerald-600 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </span>
                    ) : (
                      "Save Deposit"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </VendorModal>
      ) : null}
    </>
  );
}
