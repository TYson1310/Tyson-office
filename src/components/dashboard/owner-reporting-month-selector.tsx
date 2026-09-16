"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";

export function OwnerReportingMonthSelector({
  currentMonth,
  selectedMonth,
}: {
  currentMonth: string;
  selectedMonth: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [displayedMonth, setDisplayedMonth] = useState(selectedMonth);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setDisplayedMonth(selectedMonth);
  }, [selectedMonth]);

  const selectMonth = (month: string) => {
    setDisplayedMonth(month);

    if (!/^\d{4}-\d{2}$/.test(month) || month > currentMonth) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("month", month);

    startTransition(() => {
      router.push(`/admin/owner-command-center?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-stroke bg-white px-5 py-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <CalendarDays className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-dark dark:text-white">
            Reporting month
          </div>
          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
            Controls monthly totals, money position, and reconciliation review.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="owner-reporting-month" className="sr-only">
          Select reporting month
        </label>
        <input
          id="owner-reporting-month"
          type="month"
          value={displayedMonth}
          max={currentMonth}
          disabled={isPending}
          onChange={(event) => selectMonth(event.target.value)}
          className="app-input min-w-44 disabled:cursor-wait disabled:opacity-70"
        />
        {isPending ? (
          <Loader2
            className="h-4 w-4 animate-spin text-primary"
            aria-label="Loading reporting month"
          />
        ) : null}
      </div>
    </div>
  );
}
