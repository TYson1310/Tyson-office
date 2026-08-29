import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type VendorFormMessageProps = {
  tone: "error" | "warning";
  title?: string;
  children: ReactNode;
  className?: string;
};

export function VendorFormMessage({
  tone,
  title,
  children,
  className,
}: VendorFormMessageProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[20px] border px-4 py-3 text-sm",
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-amber-200 bg-amber-50 text-amber-900",
        className,
      )}
    >
      {title ? <div className="font-semibold">{title}</div> : null}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}
