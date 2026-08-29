import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/audit/events";
import { canAccessPath } from "@/lib/auth/route-access";
import { getServerStoreContext } from "@/lib/stores/server";
import { getUserSafely } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/erp.types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BackupMode = "full" | "database" | "storage";

type BackupRunResult = {
  backupDir: string | null;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
};

const BACKUP_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_OUTPUT_LENGTH = 12_000;

let backupInProgress = false;

function normalizeBackupMode(value: unknown): BackupMode {
  if (value === "database" || value === "storage") {
    return value;
  }

  return "full";
}

function getBackupArgs(mode: BackupMode) {
  if (mode === "database") {
    return ["--db-only"];
  }

  if (mode === "storage") {
    return ["--storage-only"];
  }

  return [];
}

function appendOutput(currentOutput: string, chunk: Buffer) {
  const nextOutput = `${currentOutput}${chunk.toString("utf8")}`;

  if (nextOutput.length <= MAX_OUTPUT_LENGTH) {
    return nextOutput;
  }

  return `[output truncated]\n${nextOutput.slice(-MAX_OUTPUT_LENGTH)}`;
}

function extractBackupDir(output: string) {
  const match = output.match(/^Backup complete:\s*(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function runBackupScript(mode: BackupMode): Promise<BackupRunResult> {
  const scriptPath = join(process.cwd(), "scripts", "backup-supabase.mjs");

  if (!existsSync(scriptPath)) {
    return Promise.reject(new Error("Backup script not found."));
  }

  return new Promise((resolveRun, rejectRun) => {
    let output = "";
    let timedOut = false;
    let settled = false;
    let forceKillTimeout: NodeJS.Timeout | null = null;

    const child = spawn(process.execPath, [scriptPath, ...getBackupArgs(mode)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      forceKillTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
    }, BACKUP_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      output = appendOutput(output, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      output = appendOutput(output, chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }

      rejectRun(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }

      const trimmedOutput = output.trim();

      resolveRun({
        backupDir: extractBackupDir(trimmedOutput),
        exitCode,
        output: trimmedOutput,
        timedOut,
      });
    });
  });
}

export async function POST(request: NextRequest) {
  let acquiredBackupLock = false;

  if (backupInProgress) {
    return NextResponse.json(
      { message: "A backup is already running. Try again after it finishes." },
      { status: 409 },
    );
  }

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { message: "Supabase configuration required." },
        { status: 503 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await getUserSafely(supabase);

    if (userError || !user) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role,permissions,full_name")
      .eq("id", user.id)
      .single<{
        role: UserRole | null;
        permissions: string[] | null;
        full_name: string | null;
      }>();

    if (
      !canAccessPath("/admin/store-health", profile?.role, profile?.permissions)
    ) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      mode?: unknown;
    } | null;
    const mode = normalizeBackupMode(body?.mode);
    const storeContext = await getServerStoreContext();

    if (!storeContext.activeStoreKey) {
      return NextResponse.json(
        { message: "Select a store before running a backup." },
        { status: 400 },
      );
    }

    if (backupInProgress) {
      return NextResponse.json(
        { message: "A backup is already running. Try again after it finishes." },
        { status: 409 },
      );
    }

    backupInProgress = true;
    acquiredBackupLock = true;
    const result = await runBackupScript(mode);

    if (result.timedOut) {
      return NextResponse.json(
        {
          message: "Backup timed out after 15 minutes.",
          output: result.output,
        },
        { status: 504 },
      );
    }

    if (result.exitCode !== 0) {
      return NextResponse.json(
        {
          message: "Backup failed.",
          output: result.output,
        },
        { status: 500 },
      );
    }

    await appendAuditEvent({
      supabase,
      storeKey: storeContext.activeStoreKey,
      entityType: "system_backup",
      entityId: result.backupDir ?? storeContext.activeStoreKey,
      action: "admin.backup_created",
      summary: `Admin ran ${mode} Supabase backup`,
      actorId: user.id,
      actorName: profile?.full_name ?? user.email ?? "User",
      actorRole: profile?.role ?? "admin",
      metadata: {
        backupDir: result.backupDir,
        mode,
      },
    });

    return NextResponse.json({
      backupDir: result.backupDir,
      message: "Backup complete.",
      output: result.output,
    });
  } catch (error) {
    console.error("Store backup error:", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Failed to run backup.",
      },
      { status: 500 },
    );
  } finally {
    if (acquiredBackupLock) {
      backupInProgress = false;
    }
  }
}
