import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  children?: ReactNode;
};

export function SectionCard({
  title,
  description,
  action,
  className,
  headerClassName,
  contentClassName,
  children,
}: SectionCardProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-[24px] border border-slate-200/80 bg-white/90 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:rounded-[28px]",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-4 border-b border-slate-200/80 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5",
          headerClassName,
        )}
      >
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-950 sm:text-lg">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              {description}
            </p>
          )}
        </div>
        {action ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {action}
          </div>
        ) : null}
      </div>

      {children ? (
        <div className={cn("p-4 sm:p-5", contentClassName)}>{children}</div>
      ) : null}
    </section>
  );
}
