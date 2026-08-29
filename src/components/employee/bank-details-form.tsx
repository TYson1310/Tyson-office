"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type BankDetailsFormProps = {
  initialBankName?: string | null;
  initialAccountLast4?: string | null;
};

type NoticeState =
  | {
      type: "success" | "error";
      message: string;
    }
  | null;

function formatAccountEnding(value?: string | null) {
  return value ? `••••${value}` : "Not configured";
}

export function BankDetailsForm({
  initialBankName,
  initialAccountLast4,
}: BankDetailsFormProps) {
  const router = useRouter();
  const [bankName, setBankName] = useState(initialBankName ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [notice, setNotice] = useState<NoticeState>(null);
  const [currentBankName, setCurrentBankName] = useState(initialBankName ?? null);
  const [currentAccountLast4, setCurrentAccountLast4] = useState(
    initialAccountLast4 ?? null,
  );
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    setNotice(null);

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/profile/bank-details", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              bankName,
              accountNumber,
            }),
          });
          const result = (await response.json()) as {
            bankName?: string | null;
            bankAccountLast4?: string | null;
            error?: string;
          };

          if (!response.ok || result.error) {
            throw new Error(result.error ?? "Failed to update bank details");
          }

          setCurrentBankName(result.bankName ?? null);
          setCurrentAccountLast4(result.bankAccountLast4 ?? null);
          setAccountNumber("");
          setNotice({
            type: "success",
            message: "Bank details updated.",
          });
          router.refresh();
        } catch (error) {
          setNotice({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Failed to update bank details",
          });
        }
      })();
    });
  };

  const handleClear = () => {
    setNotice(null);

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/profile/bank-details", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              clear: true,
            }),
          });
          const result = (await response.json()) as {
            error?: string;
          };

          if (!response.ok || result.error) {
            throw new Error(result.error ?? "Failed to clear bank details");
          }

          setCurrentBankName(null);
          setCurrentAccountLast4(null);
          setBankName("");
          setAccountNumber("");
          setNotice({
            type: "success",
            message: "Bank details cleared.",
          });
          router.refresh();
        } catch (error) {
          setNotice({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Failed to clear bank details",
          });
        }
      })();
    });
  };

  return (
    <div className="rounded-lg border border-stroke p-4 dark:border-dark-3">
      <div className="mb-4">
        <label className="text-sm font-medium text-dark dark:text-white">
          Bank Name
        </label>
        <p className="mt-1 text-dark-5 dark:text-dark-6">
          {currentBankName ?? "Not configured"}
        </p>
      </div>
      <div className="mb-6">
        <label className="text-sm font-medium text-dark dark:text-white">
          Account Ending
        </label>
        <p className="mt-1 text-dark-5 dark:text-dark-6">
          {formatAccountEnding(currentAccountLast4)}
        </p>
      </div>

      <div className="grid gap-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
            Update Bank Name
          </label>
          <input
            type="text"
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
            className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
            placeholder="Chase, Bank of America, etc."
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
            Account Number
          </label>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
            className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
            placeholder={
              currentAccountLast4
                ? "Enter a new account number to replace the current one"
                : "Enter account number"
            }
          />
          <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
            Only the last 4 digits are stored for payroll display.
          </p>
        </div>
      </div>

      {notice ? (
        <div
          className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            notice.type === "success"
              ? "border-green/20 bg-green/10 text-green"
              : "border-red/20 bg-red/10 text-red"
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Save Bank Details"}
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={isPending || (!currentBankName && !currentAccountLast4)}
          className="rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark transition-colors hover:bg-gray-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
