"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";

const INPUT_CLASSNAME = "app-input";

export function VoidBankDepositButton({
  depositId,
  disabled = false,
}: {
  depositId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (!reason.trim()) {
        throw new Error("Enter a reason before voiding this deposit.");
      }

      const response = await fetch("/api/bank-deposits", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: depositId,
          voidReason: reason.trim(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to void bank deposit.");
      }

      setIsOpen(false);
      setReason("");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to void bank deposit.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setReason("");
          setIsOpen(true);
        }}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-full border border-red/20 px-3 py-1.5 text-xs font-semibold text-red transition hover:bg-red/5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Ban className="h-3.5 w-3.5" />
        Void
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-lg rounded-[24px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-lg font-semibold text-dark dark:text-white">
                    Void bank deposit
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    This removes the deposit from cash-on-hand while preserving
                    the original record.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !isSubmitting && setIsOpen(false)}
                  className="app-icon-button"
                  aria-label="Close void bank deposit dialog"
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
                {error ? (
                  <div className="rounded-lg bg-red/10 p-3 text-sm text-red">
                    {error}
                  </div>
                ) : null}

                <div>
                  <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    Void reason
                  </label>
                  <textarea
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className={`${INPUT_CLASSNAME} min-h-24 resize-y`}
                    placeholder="Explain the correction needed"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    disabled={isSubmitting}
                    className="app-secondary-button-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-full bg-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Voiding
                      </>
                    ) : (
                      "Void deposit"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
