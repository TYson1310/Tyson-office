import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { StatusBadge } from "./status-badge";

const accentClasses = {
  green: "from-green/15 to-transparent",
  amber: "from-yellow/20 to-transparent",
  red: "from-red-light/15 to-transparent",
  blue: "from-primary/15 to-transparent",
  slate: "from-slate-200/70 to-transparent",
  violet: "from-purple-500/15 to-transparent",
} as const;

type StatCardProps = {
  label: string;
  value: ReactNode;
  change?: ReactNode;
  detail?: ReactNode;
  tone: keyof typeof accentClasses;
  className?: string;
  icon?: ReactNode;
};

const iconToneClasses = {
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
  slate: "bg-slate-100 text-slate-700",
  violet: "bg-violet-50 text-violet-700",
} as const;

export function StatCard({
  label,
  value,
  change,
  detail,
  tone,
  className,
  icon,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[20px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:rounded-[24px] sm:p-5",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b",
          accentClasses[tone],
        )}
      />

      <div className="relative min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-xs font-medium text-slate-500 sm:text-sm">
            {label}
          </div>
          {icon ? (
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl sm:h-11 sm:w-11",
                iconToneClasses[tone],
              )}
            >
              {icon}
            </div>
          ) : null}
        </div>
        <div className="mt-3 break-words text-2xl font-bold text-slate-950 sm:text-3xl">
          {value}
        </div>
        {change || detail ? (
          <div className="mt-4 flex flex-wrap items-start gap-2">
            {change ? <StatusBadge tone={tone}>{change}</StatusBadge> : null}
            {detail ? (
              <span className="text-xs text-slate-500 sm:text-sm">
                {detail}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
