import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { OperationsCompatibilityNotice } from "@/components/erp/operations-compatibility-notice";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAuditEventsForActiveStore } from "@/lib/audit/events";
import { formatDateTime } from "@/lib/date-time";
import { getOperationsDataset } from "@/lib/erp/operations";
import { requireActiveStoreContext } from "@/lib/stores/server";

type RiskRow = {
  amount?: number;
  date: Date;
  detail: string;
  severity: "High" | "Medium" | "Review";
  title: string;
};

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function isRecent(value: Date, days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return value >= cutoff;
}

function addAmount(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

export default async function LossPreventionPage() {
  const { activeStore } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  const auditLedger = await listAuditEventsForActiveStore(150);
  const salesByDay = new Map<string, number>();
  const depositsByDay = new Map<string, number>();

  for (const summary of dataset.salesSummaries.filter((row) =>
    isRecent(row.date, 14),
  )) {
    addAmount(salesByDay, toDateKey(summary.date), summary.cashSales);
  }

  for (const deposit of dataset.bankDeposits.filter(
    (row) => row.status !== "void" && isRecent(row.date, 14),
  )) {
    addAmount(depositsByDay, toDateKey(deposit.date), deposit.amount);
  }

  const cashGapRows = Array.from(
    new Set([...salesByDay.keys(), ...depositsByDay.keys()]),
  )
    .map((dateKey) => {
      const cashSales = salesByDay.get(dateKey) ?? 0;
      const deposits = depositsByDay.get(dateKey) ?? 0;
      return {
        cashSales,
        date: new Date(`${dateKey}T12:00:00.000Z`),
        deposits,
        gap: cashSales - deposits,
      };
    })
    .filter((row) => Math.abs(row.gap) >= 1)
    .sort((left, right) => Math.abs(right.gap) - Math.abs(left.gap));

  const unreconciledSales = dataset.salesSummaries.filter(
    (summary) => !summary.reconciled,
  );
  const varianceRows = dataset.salesReconciliations
    .filter((row) => Math.abs(row.variance) >= 1)
    .sort((left, right) => Math.abs(right.variance) - Math.abs(left.variance));
  const afterEntrySalesEvents = auditLedger.events.filter((event) =>
    ["sales.updated", "sales.reversed"].includes(event.action),
  );
  const reportExports = auditLedger.events.filter(
    (event) => event.action === "reports.exported",
  );

  const risks: RiskRow[] = [
    ...cashGapRows.slice(0, 8).map((row) => ({
      amount: row.gap,
      date: row.date,
      detail: `Cash sales ${formatCurrency(row.cashSales)} vs deposits ${formatCurrency(
        row.deposits,
      )}`,
      severity:
        Math.abs(row.gap) >= 100 ? ("High" as const) : ("Review" as const),
      title: "Cash deposit gap",
    })),
    ...unreconciledSales.slice(0, 6).map((summary) => ({
      amount: summary.cashSales,
      date: summary.date,
      detail: `${summary.lineCount} sale lines remain open`,
      severity: "Medium" as const,
      title: "Unreconciled sales day",
    })),
    ...varianceRows.slice(0, 6).map((row) => ({
      amount: row.variance,
      date: row.date,
      detail: `Expected ${formatCurrency(row.totalExpected)} vs counted ${formatCurrency(
        row.totalActual,
      )}`,
      severity:
        Math.abs(row.variance) >= 100 ? ("High" as const) : ("Review" as const),
      title: "Drawer variance",
    })),
    ...afterEntrySalesEvents.slice(0, 6).map((event) => ({
      date: event.createdAt,
      detail: `${event.summary} by ${event.actorName ?? "User"}`,
      severity: "Medium" as const,
      title: "Sales entry changed",
    })),
    ...reportExports.slice(0, 4).map((event) => ({
      date: event.createdAt,
      detail: `${event.summary} by ${event.actorName ?? "User"}`,
      severity: "Review" as const,
      title: "Report exported",
    })),
  ].sort((left, right) => right.date.getTime() - left.date.getTime());

  const metrics = [
    {
      change: "14 days",
      detail: "cash sales less same-day deposits",
      label: "Cash Gap",
      tone: cashGapRows.length > 0 ? ("amber" as const) : ("green" as const),
      value: formatCurrency(cashGapRows.reduce((sum, row) => sum + row.gap, 0)),
    },
    {
      change: "Open",
      detail: "sales days not reconciled",
      label: "Unreconciled",
      tone:
        unreconciledSales.length > 0 ? ("amber" as const) : ("green" as const),
      value: unreconciledSales.length,
    },
    {
      change: "Non-zero",
      detail: "drawer variances needing review",
      label: "Variance",
      tone: varianceRows.length > 0 ? ("red" as const) : ("green" as const),
      value: varianceRows.length,
    },
    {
      change: "Audit",
      detail: "sales edits or reversals in ledger",
      label: "Edits",
      tone:
        afterEntrySalesEvents.length > 0
          ? ("amber" as const)
          : ("green" as const),
      value: afterEntrySalesEvents.length,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Loss Prevention" />

      <div className="space-y-6">
        {dataset.source !== "database" ? (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Supabase operational records are not available. Loss prevention
            checks need live store data.
          </div>
        ) : null}

        <OperationsCompatibilityNotice
          warnings={[
            ...dataset.compatibilityWarnings,
            ...(auditLedger.warning ? [auditLedger.warning] : []),
          ]}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <SectionCard
          title="Accountability Queue"
          description={`Cash, sales, deposit, and audit exceptions for ${activeStore.name}. Timestamps use ${activeStore.timeZone}.`}
        >
          {risks.length === 0 ? (
            <p className="text-sm text-dark-5 dark:text-dark-6">
              No current loss-prevention exceptions were found for this store.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="text-right">Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {risks.map((risk, index) => (
                  <TableRow
                    key={`${risk.title}-${risk.date.toISOString()}-${index}`}
                  >
                    <TableCell>
                      {formatDateTime(risk.date, {
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        month: "short",
                        timeZone: activeStore.timeZone,
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="font-medium text-dark dark:text-white">
                      {risk.title}
                    </TableCell>
                    <TableCell>{risk.detail}</TableCell>
                    <TableCell>
                      {typeof risk.amount === "number"
                        ? formatCurrency(risk.amount)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {risk.severity}
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
