"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2 } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type DeletePayrollButtonProps = {
  statementId: string;
  employeeName: string;
  periodLabel: string;
  disabled?: boolean;
};

export function DeletePayrollButton({
  statementId,
  employeeName,
  periodLabel,
  disabled = false,
}: DeletePayrollButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    if (
      !window.confirm(
        `Archive payroll for ${employeeName} in ${periodLabel}? The record will remain in the audit trail but be locked from further edits.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/payroll?type=paystub&id=${encodeURIComponent(statementId)}`,
          {
            method: "DELETE",
          },
        );
        const body = (await response.json()) as { message?: string };

        if (!response.ok) {
          throw new Error(body.message ?? "Failed to archive payroll record");
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to archive payroll record",
        );
      } finally {
        setIsDeleting(false);
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={disabled || isDeleting}
      className="app-icon-button app-danger-icon-button disabled:cursor-not-allowed disabled:opacity-60"
      title="Archive payroll"
      aria-label="Archive payroll"
    >
      {isDeleting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Archive className="h-4 w-4" />
      )}
    </button>
  );
}
