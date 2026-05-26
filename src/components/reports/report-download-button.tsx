import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getReportExportHref,
  type ReportExportKey,
} from "@/lib/reports/export";

type ReportDownloadButtonProps = {
  report: ReportExportKey;
  label?: string;
  iconOnly?: boolean;
  className?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
};

export function ReportDownloadButton({
  report,
  label = "Download report",
  iconOnly = false,
  className,
  params,
}: ReportDownloadButtonProps) {
  return (
    <a
      href={getReportExportHref(report, params)}
      className={cn(
        iconOnly
          ? "app-icon-button"
          : "inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90",
        className,
      )}
      aria-label={label}
      title={label}
    >
      <Download className="h-4 w-4" />
      {iconOnly ? null : label}
    </a>
  );
}
