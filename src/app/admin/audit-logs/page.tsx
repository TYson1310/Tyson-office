import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { listAuditEventsForActiveStore } from "@/lib/audit/events";
import { formatDateTime } from "@/lib/date-time";
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
import { getOperationsDataset } from "@/lib/erp/operations";
import { requireActiveStoreContext } from "@/lib/stores/server";

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

export default async function AuditLogsPage() {
  const { activeStore } = await requireActiveStoreContext();
  const dataset = await getOperationsDataset();
  const auditLedger = await listAuditEventsForActiveStore();
  const logs = auditLedger.events.map((event) => ({
    id: event.id,
    timestamp: event.createdAt,
    userName: event.actorName ?? "User",
    userRole: event.actorRole,
    action: formatActionLabel(event.action),
    entity: formatEntityLabel(event.entityType),
    details: event.summary,
    status: getAuditEventStatus(event.action),
  }));
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
                    <TableCell>{log.details}</TableCell>
                    <TableCell className="text-right capitalize">
                        {log.status}
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
