type OperationsCompatibilityNoticeProps = {
  warnings: string[];
  className?: string;
};

export function OperationsCompatibilityNotice({
  warnings,
  className,
}: OperationsCompatibilityNoticeProps) {
  const uniqueWarnings = Array.from(new Set(warnings.filter(Boolean)));

  if (uniqueWarnings.length === 0) {
    return null;
  }

  return (
    <div
      className={[
        "rounded-[24px] border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-900 shadow-[0_18px_40px_rgba(120,53,15,0.08)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="font-semibold">Legacy compatibility mode is active.</p>
      <p className="mt-1 leading-6 text-amber-800/90">
        This store is running on an older Supabase finance schema. Some controls
        and reports are using fallback queries until pending migrations are
        applied.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-800/90">
        {uniqueWarnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}
