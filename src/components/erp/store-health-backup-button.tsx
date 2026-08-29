"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";

type BackupResponse = {
  backupDir?: string | null;
  message?: string;
  output?: string;
};

type BackupStatus = {
  detail?: string;
  tone: "success" | "error";
  message: string;
};

function getLastOutputLine(output?: string) {
  if (!output) {
    return undefined;
  }

  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.at(-1);
}

async function readBackupResponse(response: Response) {
  try {
    return (await response.json()) as BackupResponse;
  } catch {
    return {} as BackupResponse;
  }
}

export function StoreHealthBackupButton() {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [isRefreshing, startRefresh] = useTransition();
  const disabled = isRunning || isRefreshing;

  const handleRunBackup = async () => {
    setIsRunning(true);
    setStatus(null);

    try {
      const response = await fetch("/api/admin/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full" }),
      });
      const payload = await readBackupResponse(response);
      const outputLine = getLastOutputLine(payload.output);

      if (!response.ok) {
        throw new Error(
          outputLine
            ? `${payload.message ?? "Backup failed."} ${outputLine}`
            : payload.message ?? "Backup failed.",
        );
      }

      setStatus({
        detail: payload.backupDir ?? outputLine,
        message: payload.message ?? "Backup complete.",
        tone: "success",
      });
      startRefresh(() => router.refresh());
    } catch (error) {
      setStatus({
        message:
          error instanceof Error ? error.message : "Failed to run backup.",
        tone: "error",
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
      <button
        type="button"
        onClick={handleRunBackup}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {isRunning ? "Running backup..." : "Run backup"}
      </button>

      {status ? (
        <div
          className={
            status.tone === "success"
              ? "max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
              : "max-w-sm rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          }
          role="status"
        >
          <div className="font-semibold">{status.message}</div>
          {status.detail ? (
            <div className="mt-1 break-words font-mono text-[11px]">
              {status.detail}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
