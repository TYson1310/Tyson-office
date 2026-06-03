import type { Metadata } from "next";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadFinancialAccountabilityStatus } from "@/lib/accountability/financial-controls";
import { listAuditEventsForActiveStore } from "@/lib/audit/events";
import { formatDateTime } from "@/lib/date-time";
import { getOperationsDataset } from "@/lib/erp/operations";
import { requireActiveStoreContext } from "@/lib/stores/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  getExpenseDocumentsBucket,
  getPayrollDocumentsBucket,
  getVendorInvoiceDocumentsBucket,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Store Health",
};

type Tone = "green" | "amber" | "red" | "blue" | "slate" | "violet";

type BackupManifest = {
  createdAt?: string;
  backupDir?: string;
  database?: {
    skipped?: boolean;
    files?: unknown[];
  };
  storage?: {
    skipped?: boolean;
    buckets?: unknown[];
    files?: unknown[];
  };
  warnings?: unknown[];
};

type BackupSummary = {
  ageHours: number;
  createdAt: Date;
  databaseSkipped: boolean;
  manifestPath: string;
  storageSkipped: boolean;
  warningCount: number;
};

type StorageBucketCheck = {
  detail: string;
  exists: boolean;
  name: string;
  purpose: string;
  tone: Tone;
};

function readJsonFile(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BackupManifest;
  } catch {
    return null;
  }
}

function loadLatestBackupSummary(): BackupSummary | null {
  const configuredBackupDir = process.env.SUPABASE_BACKUP_DIR?.trim();
  const backupRoot = configuredBackupDir
    ? resolve(/*turbopackIgnore: true*/ process.cwd(), configuredBackupDir)
    : join(process.cwd(), "backups", "supabase");

  if (!existsSync(backupRoot)) {
    return null;
  }

  const manifests = readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(backupRoot, entry.name, "manifest.json"))
    .filter((path) => existsSync(path))
    .map((path) => {
      const manifest = readJsonFile(path);
      const fallbackTime = statSync(path).mtime;
      const createdAt = manifest?.createdAt
        ? new Date(manifest.createdAt)
        : fallbackTime;

      if (Number.isNaN(createdAt.getTime())) {
        return null;
      }

      return {
        ageHours: Math.max(
          0,
          Math.round((Date.now() - createdAt.getTime()) / 3_600_000),
        ),
        createdAt,
        databaseSkipped: Boolean(manifest?.database?.skipped),
        manifestPath: path,
        storageSkipped: Boolean(manifest?.storage?.skipped),
        warningCount: Array.isArray(manifest?.warnings)
          ? manifest.warnings.length
          : 0,
      } satisfies BackupSummary;
    })
    .filter((summary): summary is BackupSummary => Boolean(summary))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  return manifests[0] ?? null;
}

function formatBackupAge(summary: BackupSummary | null) {
  if (!summary) {
    return "No backup";
  }

  if (summary.ageHours < 24) {
    return `${summary.ageHours}h old`;
  }

  const days = Math.floor(summary.ageHours / 24);
  const hours = summary.ageHours % 24;
  return `${days}d ${hours}h old`;
}

function getBackupTone(summary: BackupSummary | null): Tone {
  if (!summary) {
    return "red";
  }

  if (summary.ageHours <= 36 && summary.warningCount === 0) {
    return "green";
  }

  if (summary.ageHours <= 168) {
    return "amber";
  }

  return "red";
}

async function loadStorageBucketChecks(): Promise<StorageBucketCheck[]> {
  const expectedBuckets = [
    {
      name: getPayrollDocumentsBucket(),
      purpose: "Payroll documents",
    },
    {
      name: getVendorInvoiceDocumentsBucket(),
      purpose: "Vendor invoice documents",
    },
    {
      name: getExpenseDocumentsBucket(),
      purpose: "Expense documents",
    },
  ];

  if (!isSupabaseAdminConfigured()) {
    return expectedBuckets.map((bucket) => ({
      ...bucket,
      detail: "SUPABASE_SERVICE_ROLE_KEY is not configured",
      exists: false,
      tone: "amber" as const,
    }));
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient.storage.listBuckets();

    if (error) {
      return expectedBuckets.map((bucket) => ({
        ...bucket,
        detail: error.message ?? "Failed to list storage buckets",
        exists: false,
        tone: "red" as const,
      }));
    }

    const bucketNames = new Set((data ?? []).map((bucket) => bucket.name));

    return expectedBuckets.map((bucket) => {
      const exists = bucketNames.has(bucket.name);

      return {
        ...bucket,
        detail: exists ? "Bucket exists" : "Create bucket in Supabase Storage",
        exists,
        tone: exists ? ("green" as const) : ("red" as const),
      };
    });
  } catch (error) {
    return expectedBuckets.map((bucket) => ({
      ...bucket,
      detail:
        error instanceof Error ? error.message : "Failed to inspect buckets",
      exists: false,
      tone: "red" as const,
    }));
  }
}

function formatHealthDate(value: Date, timeZone: string) {
  return formatDateTime(value, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
}

export default async function StoreHealthPage() {
  const { activeStore, activeStoreKey } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  const [backupSummary, storageBuckets, auditLedger] = await Promise.all([
    Promise.resolve(loadLatestBackupSummary()),
    loadStorageBucketChecks(),
    listAuditEventsForActiveStore(25),
  ]);

  let accountabilityStatus = {
    available: false,
    warnings: isSupabaseConfigured()
      ? ([] as string[])
      : ["Supabase is not configured."],
  };

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    accountabilityStatus = await loadFinancialAccountabilityStatus(
      supabase,
      activeStoreKey,
    );
  }

  const dataCounts = [
    { label: "Products", value: dataset.products.length, detail: "stock SKUs" },
    {
      label: "Employees",
      value: dataset.employees.length,
      detail: "staff profiles",
    },
    {
      label: "Suppliers",
      value: dataset.suppliers.length,
      detail: "vendor directory",
    },
    {
      label: "Sales summaries",
      value: dataset.salesSummaries.length,
      detail: "daily sales days",
    },
    {
      label: "Sales reconciliations",
      value: dataset.salesReconciliations.length,
      detail: "closeout records",
    },
    {
      label: "Vendor invoices",
      value: dataset.vendorInvoices.length,
      detail: "supplier bills",
    },
    {
      label: "Expenses",
      value: dataset.expenses.length,
      detail: "store expenses",
    },
    {
      label: "Bank deposits",
      value: dataset.bankDeposits.length,
      detail: "cash deposits",
    },
    {
      label: "Inventory movements",
      value: dataset.inventoryMovements.length,
      detail: "stock audit entries",
    },
  ];
  const storageReady = storageBuckets.every((bucket) => bucket.exists);
  const migrationChecks = [
    {
      detail: isSupabaseConfigured()
        ? "Public URL and publishable key are present"
        : "Set NEXT_PUBLIC_SUPABASE_URL and publishable key",
      name: "Supabase client config",
      status: isSupabaseConfigured() ? "Ready" : "Missing",
      tone: isSupabaseConfigured() ? ("green" as const) : ("red" as const),
    },
    {
      detail: isSupabaseAdminConfigured()
        ? "Service role key is configured for private health checks"
        : "Storage and private repair checks are limited",
      name: "Supabase admin config",
      status: isSupabaseAdminConfigured() ? "Ready" : "Limited",
      tone: isSupabaseAdminConfigured()
        ? ("green" as const)
        : ("amber" as const),
    },
    {
      detail: accountabilityStatus.available
        ? "Financial controls and EFT paid amount columns are queryable"
        : accountabilityStatus.warnings.join(" "),
      name: "Financial accountability migrations",
      status: accountabilityStatus.available ? "Ready" : "Review",
      tone: accountabilityStatus.available
        ? ("green" as const)
        : ("amber" as const),
    },
    {
      detail:
        auditLedger.warning ??
        `${auditLedger.events.length} recent events loaded from audit ledger`,
      name: "Audit ledger migration",
      status: auditLedger.warning ? "Review" : "Ready",
      tone: auditLedger.warning ? ("amber" as const) : ("green" as const),
    },
    {
      detail:
        dataset.compatibilityWarnings.length === 0
          ? "Operations schema matches the current app queries"
          : dataset.compatibilityWarnings.join(" "),
      name: "Operations schema compatibility",
      status: dataset.compatibilityWarnings.length === 0 ? "Ready" : "Review",
      tone:
        dataset.compatibilityWarnings.length === 0
          ? ("green" as const)
          : ("amber" as const),
    },
    {
      detail: storageReady
        ? "All expected document buckets exist"
        : "One or more document buckets need review",
      name: "Storage buckets",
      status: storageReady ? "Ready" : "Review",
      tone: storageReady ? ("green" as const) : ("amber" as const),
    },
    {
      detail: backupSummary
        ? `${formatHealthDate(
            backupSummary.createdAt,
            activeStore.timeZone,
          )} (${backupSummary.manifestPath})`
        : "No local backup manifest found under backups/supabase",
      name: "Latest local backup",
      status: backupSummary ? formatBackupAge(backupSummary) : "Missing",
      tone: getBackupTone(backupSummary),
    },
  ];
  const metrics = [
    {
      detail: isSupabaseConfigured()
        ? "client config present"
        : "client config missing",
      label: "Supabase",
      tone: isSupabaseConfigured() ? ("green" as const) : ("red" as const),
      value: isSupabaseConfigured() ? "Ready" : "Missing",
    },
    {
      detail: isSupabaseAdminConfigured()
        ? "admin health checks enabled"
        : "admin checks limited",
      label: "Admin key",
      tone: isSupabaseAdminConfigured()
        ? ("green" as const)
        : ("amber" as const),
      value: isSupabaseAdminConfigured() ? "Ready" : "Limited",
    },
    {
      detail: backupSummary
        ? `${backupSummary.warningCount} backup warnings`
        : "no manifest found",
      label: "Backup age",
      tone: getBackupTone(backupSummary),
      value: formatBackupAge(backupSummary),
    },
    {
      detail: "active store records loaded",
      label: "Data records",
      tone: dataset.source === "database" ? ("blue" as const) : ("amber" as const),
      value: dataCounts
        .reduce((sum, item) => sum + item.value, 0)
        .toLocaleString("en-US"),
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Store Health" />

      <div className="space-y-6">
        <OperationsCompatibilityNotice
          warnings={[
            ...dataset.compatibilityWarnings,
            ...accountabilityStatus.warnings,
          ]}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <SectionCard
          title="Migration and feature checks"
          description={`Live health checks for ${activeStore.name}.`}
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <Table totalRows={migrationChecks.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Check</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {migrationChecks.map((check) => (
                  <TableRow key={check.name}>
                    <TableCell className="font-semibold text-slate-950">
                      {check.name}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={check.tone}>{check.status}</StatusBadge>
                    </TableCell>
                    <TableCell>{check.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Storage buckets"
          description="Expected Supabase Storage buckets for uploaded business documents."
          contentClassName="p-0"
        >
          <div className="overflow-x-auto">
            <Table totalRows={storageBuckets.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storageBuckets.map((bucket) => (
                  <TableRow key={bucket.name}>
                    <TableCell className="font-mono text-xs font-semibold text-slate-950">
                      {bucket.name}
                    </TableCell>
                    <TableCell>{bucket.purpose}</TableCell>
                    <TableCell>
                      <StatusBadge tone={bucket.tone}>
                        {bucket.exists ? "Ready" : "Review"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>{bucket.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="Active store data counts"
          description="Quick accountability counts for the active store workspace."
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {dataCounts.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {item.label}
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-950">
                  {item.value.toLocaleString("en-US")}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {item.detail}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Backup restore drill"
          description="Backup creation is not enough; the documented restore must be tested into a separate Supabase project."
        >
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Latest backup
              </div>
              <div className="mt-2 text-xl font-bold text-slate-950">
                {backupSummary
                  ? formatHealthDate(
                      backupSummary.createdAt,
                      activeStore.timeZone,
                    )
                  : "No backup manifest"}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge tone={getBackupTone(backupSummary)}>
                  {formatBackupAge(backupSummary)}
                </StatusBadge>
                {backupSummary?.databaseSkipped ? (
                  <StatusBadge tone="red">Database skipped</StatusBadge>
                ) : null}
                {backupSummary?.storageSkipped ? (
                  <StatusBadge tone="amber">Storage skipped</StatusBadge>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
              <div className="font-semibold text-slate-950">
                Restore test steps
              </div>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
                <li>Create a throwaway Supabase project.</li>
                <li>Restore roles, schema, and data with `psql`.</li>
                <li>Upload backed-up storage files to matching buckets.</li>
                <li>Point a temporary env file at the restored project.</li>
                <li>Build the app and smoke-test default store data.</li>
                <li>Record the drill date, backup folder, result, and issues.</li>
              </ol>
              <p className="mt-3 text-sm font-semibold text-slate-700">
                Full checklist: docs/local-backups.md
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
