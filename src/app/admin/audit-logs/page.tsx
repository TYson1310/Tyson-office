import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { listAuditEventsForActiveStore } from "@/lib/audit/events";
import { formatDateTime, getIsoDateKeyInTimeZone } from "@/lib/date-time";
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
import { getOperationsDataset } from "@/lib/erp/operations";
import { requireActiveStoreContext } from "@/lib/stores/server";

type PageProps = {
  searchParams: Promise<{
    entity?: string | string[];
    from?: string | string[];
    maxAmount?: string | string[];
    minAmount?: string | string[];
    to?: string | string[];
    user?: string | string[];
  }>;
};

const amountMetadataKeys = [
  "amount",
  "amountPaid",
  "amount_paid",
  "balance",
  "calculatedRevenue",
  "calculated_revenue",
  "netEftDue",
  "net_eft_due",
  "packValue",
  "pack_value",
  "paidAmount",
  "paid_amount",
  "total",
];

function getAuditEventStatus(action: string) {
  if (action.endsWith(".voided") || action.endsWith(".archived")) {
    return "warning" as const;
  }

  return "success" as const;
}

function formatEntityLabel(entityType: string) {
  return entityType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatActionLabel(action: string) {
  return action
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseAmountFilter(value: string | string[] | undefined) {
  const rawValue = getFirstSearchParam(value);

  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTextFilter(value: string | string[] | undefined) {
  return getFirstSearchParam(value)?.trim() ?? "";
}

function parseDateFilter(value: string | string[] | undefined) {
  const rawValue = getFirstSearchParam(value)?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(rawValue) ? rawValue : "";
}

function normalizeFilterText(value: string) {
  return value.trim().toLowerCase();
}

function normalizeAuditAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function extractAmountFromMetadata(
  metadata: Record<string, unknown>,
  depth = 0,
): number | null {
  if (depth > 2) {
    return null;
  }

  for (const key of amountMetadataKeys) {
    const amount = normalizeAuditAmount(metadata[key]);

    if (amount !== null) {
      return amount;
    }
  }

  for (const value of Object.values(metadata)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const amount = extractAmountFromMetadata(
      value as Record<string, unknown>,
      depth + 1,
    );

    if (amount !== null) {
      return amount;
    }
  }

  return null;
}

function extractAmountFromSummary(summary: string) {
  const match = summary.match(/\$(-?\d[\d,]*(?:\.\d{1,2})?)/);

  if (!match?.[1]) {
    return null;
  }

  return normalizeAuditAmount(match[1]);
}

function formatOptionalAmount(value: number | null) {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

export default async function AuditLogsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { activeStore } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  const auditLedger = await listAuditEventsForActiveStore(500);
  const filters = {
    entity: parseTextFilter(params.entity),
    from: parseDateFilter(params.from),
    maxAmount: parseAmountFilter(params.maxAmount),
    minAmount: parseAmountFilter(params.minAmount),
    to: parseDateFilter(params.to),
    user: parseTextFilter(params.user),
  };
  const rawLogs = auditLedger.events.map((event) => {
    const amount =
      extractAmountFromMetadata(event.metadata) ??
      extractAmountFromSummary(event.summary);
    const status = getAuditEventStatus(event.action);

    return {
      action: formatActionLabel(event.action),
      amount,
      dateKey:
        getIsoDateKeyInTimeZone(event.createdAt, activeStore.timeZone) ??
        event.createdAt.toISOString().slice(0, 10),
      details: event.summary,
      entity: formatEntityLabel(event.entityType),
      entityType: event.entityType,
      id: event.id,
      status,
      statusTone: status === "success" ? ("green" as const) : ("amber" as const),
      timestamp: event.createdAt,
      userName: event.actorName ?? "User",
      userRole: event.actorRole,
    };
  });
  const logs = rawLogs.filter((log) => {
    const entityFilter = normalizeFilterText(filters.entity);
    const userFilter = normalizeFilterText(filters.user);

    if (
      entityFilter &&
      !`${log.entity} ${log.entityType}`.toLowerCase().includes(entityFilter)
    ) {
      return false;
    }

    if (
      userFilter &&
      !`${log.userName} ${log.userRole}`.toLowerCase().includes(userFilter)
    ) {
      return false;
    }

    if (filters.from && log.dateKey < filters.from) {
      return false;
    }

    if (filters.to && log.dateKey > filters.to) {
      return false;
    }

    if (filters.minAmount !== null) {
      if (log.amount === null || log.amount < filters.minAmount) {
        return false;
      }
    }

    if (filters.maxAmount !== null) {
      if (log.amount === null || log.amount > filters.maxAmount) {
        return false;
      }
    }

    return true;
  });
  const activeFilterCount = [
    filters.entity,
    filters.from,
    filters.maxAmount,
    filters.minAmount,
    filters.to,
    filters.user,
  ].filter((value) => value !== "" && value !== null).length;
  const stats = {
    total: logs.length,
    success: logs.filter((log) => log.status === "success").length,
    warning: logs.filter((log) => log.status === "warning").length,
    failure: 0,
  };
  const metrics = [
    {
      label: "Events",
      value: stats.total,
      change: "Ledger",
      detail: "append-only audit records",
      tone: "blue" as const,
    },
    {
      label: "Success",
      value: stats.success,
      change: "Processed",
      detail: "completed finance events",
      tone: "green" as const,
    },
    {
      label: "Warnings",
      value: stats.warning,
      change: "Review",
      detail: "voided or archived actions",
      tone: "amber" as const,
    },
    {
      label: "Failures",
      value: stats.failure,
      change: "Blocked",
      detail: "error events captured",
      tone: "red" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Audit Logs" />

      <div className="space-y-6">
        {dataset.source !== "database" && (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase operational records are not available. This page is showing
            an empty live state.
          </div>
        )}

        <OperationsCompatibilityNotice
          warnings={dataset.compatibilityWarnings}
        />

        {auditLedger.warning ? (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            {auditLedger.warning}
          </div>
        ) : null}

        <SectionCard
          title="Audit filters"
          description={`Showing ${logs.length} of ${rawLogs.length} recent audit events for ${activeStore.name}.`}
        >
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Entity
              </span>
              <input
                name="entity"
                defaultValue={filters.entity}
                placeholder="payroll, expense..."
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                User
              </span>
              <input
                name="user"
                defaultValue={filters.user}
                placeholder="name or role"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                From
              </span>
              <input
                name="from"
                type="date"
                defaultValue={filters.from}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                To
              </span>
              <input
                name="to"
                type="date"
                defaultValue={filters.to}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Min amount
              </span>
              <input
                name="minAmount"
                inputMode="decimal"
                defaultValue={filters.minAmount ?? ""}
                placeholder="0.00"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Max amount
              </span>
              <input
                name="maxAmount"
                inputMode="decimal"
                defaultValue={filters.maxAmount ?? ""}
                placeholder="500.00"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </label>
            <div className="flex items-end gap-2 md:col-span-2 xl:col-span-6">
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Apply filters
              </button>
              {activeFilterCount > 0 ? (
                <a
                  href="/admin/audit-logs"
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary"
                >
                  Clear
                </a>
              ) : null}
            </div>
          </form>
        </SectionCard>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <SectionCard
          title="Financial Audit Ledger"
          description={`Append-only finance events for payroll, expenses, supplier adjustments, and related controls. Timestamps are shown in ${activeStore.timeZone}.`}
        >
          {logs.length === 0 ? (
            <p className="text-sm text-dark-5 dark:text-dark-6">
              No immutable finance audit events have been recorded yet for this
              store.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                        {formatDateTime(log.timestamp, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: activeStore.timeZone,
                        })}
                    </TableCell>
                    <TableCell>
                        <div className="font-medium text-dark dark:text-white">
                          {log.userName}
                        </div>
                        <div className="text-xs text-dark-5 dark:text-dark-6">
                          {log.userRole}
                        </div>
                    </TableCell>
                    <TableCell className="font-medium text-dark dark:text-white">
                        {log.action}
                    </TableCell>
                    <TableCell>{log.entity}</TableCell>
                    <TableCell className="text-right font-semibold text-dark dark:text-white">
                        {formatOptionalAmount(log.amount)}
                    </TableCell>
                    <TableCell>{log.details}</TableCell>
                    <TableCell className="text-right">
                        <StatusBadge tone={log.statusTone}>
                          {log.status === "success" ? "Success" : "Warning"}
                        </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>
    </>
  );
}
