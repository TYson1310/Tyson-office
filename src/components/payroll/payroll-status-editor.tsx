"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

type PayrollStatementStatus = "draft" | "scheduled" | "paid" | "archived";

type PayrollStatusEditorProps = {
  statementId: string;
  initialStatus: PayrollStatementStatus;
};

type NoticeState = {
  type: "error" | "success";
  message: string;
} | null;

function toRequestStatus(status: PayrollStatementStatus) {
  if (status === "archived") {
    return "archived";
  }

  if (status === "scheduled") {
    return "processed";
  }

  return status;
}

export function PayrollStatusEditor({
  statementId,
  initialStatus,
}: PayrollStatusEditorProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] =
    useState<PayrollStatementStatus>(initialStatus);
  const [nextStatus, setNextStatus] =
    useState<PayrollStatementStatus>(initialStatus);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    if (nextStatus === currentStatus) {
      return;
    }

    setNotice(null);

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/payroll", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "paystub",
              id: statementId,
              data: {
                status: toRequestStatus(nextStatus),
              },
            }),
          });
          const result = (await response.json()) as { message?: string };

          if (!response.ok) {
            throw new Error(
              result.message ?? "Failed to update payroll status",
            );
          }

          setCurrentStatus(nextStatus);
          setNotice({
            type: "success",
            message: "Saved",
          });
          router.refresh();
        } catch (error) {
          setNotice({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Failed to update payroll status",
          });
        }
      })();
    });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <select
          value={nextStatus}
          onChange={(event) =>
            setNextStatus(event.target.value as PayrollStatementStatus)
          }
          disabled={isPending || currentStatus === "archived"}
          className="h-8 min-w-[108px] rounded-lg border border-stroke bg-transparent px-2 text-xs text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
        >
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="paid">Paid</option>
          <option value="archived">Archived</option>
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={
            isPending ||
            nextStatus === currentStatus ||
            currentStatus === "archived"
          }
          className="app-icon-button app-icon-button-accent disabled:cursor-not-allowed disabled:opacity-60"
          title="Save payroll status"
          aria-label="Save payroll status"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </button>
      </div>
      {notice ? (
        <p
          className={`text-[11px] ${
            notice.type === "error" ? "text-red" : "text-green"
          }`}
        >
          {notice.message}
        </p>
      ) : null}
    </div>
  );
}
