import type { Metadata } from "next";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/session";
import { getEmployeePayrollPageData } from "@/lib/payroll/employee-payroll";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Pay & Earnings",
};

export const dynamic = "force-dynamic";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default async function EmployeePayrollPage() {
  const auth = isSupabaseConfigured()
    ? await requireCurrentUser()
    : await getCurrentUser();
  const payrollData = await getEmployeePayrollPageData(
    auth?.user.id,
    auth?.profile,
  );
  const { employee, statements, documents, deductionBreakdown } = payrollData;
  const currentStatement =
    statements.find((statement) => statement.status === "Scheduled") ??
    statements[0] ??
    null;
  const paidStatements = statements.filter((statement) => statement.status === "Paid");
  const ytdGross = paidStatements.reduce((sum, statement) => sum + statement.gross, 0);
  const ytdDeductions = paidStatements.reduce(
    (sum, statement) => sum + statement.deductions,
    0,
  );
  const ytdNet = paidStatements.reduce((sum, statement) => sum + statement.net, 0);
  const totalBonus = paidStatements.reduce((sum, statement) => sum + statement.bonus, 0);
  const averageNet =
    paidStatements.length > 0 ? Math.round(ytdNet / paidStatements.length) : 0;
  const deductionRate = ytdGross === 0 ? 0 : ytdDeductions / ytdGross;
  const trendSource =
    paidStatements.length > 0
      ? paidStatements
      : currentStatement
        ? [currentStatement]
        : [];
  const earningsTimeline = trendSource
    .slice()
    .reverse()
    .map((statement) => ({
      label: statement.payDate,
      gross: statement.gross,
      net: statement.net,
    }));
  const latestPaidStatement = paidStatements[0] ?? null;
  const maxTrendGross = Math.max(
    ...trendSource.map((statement) => statement.gross),
    1,
  );
  const metrics = [
    {
      label: "Next take-home",
      value: currencyFormatter.format(currentStatement?.net ?? 0),
      change: currentStatement?.payDate ?? "Awaiting statement",
      detail:
        currentStatement?.status === "Scheduled"
          ? "scheduled deposit"
          : "latest net posted",
      tone: "green" as const,
    },
    {
      label: "Total earnings YTD",
      value: currencyFormatter.format(ytdGross),
      change: `${paidStatements.length} cycle${paidStatements.length === 1 ? "" : "s"}`,
      detail: "gross earnings",
      tone: "blue" as const,
    },
    {
      label: "Net paid YTD",
      value: currencyFormatter.format(ytdNet),
      change: currencyFormatter.format(averageNet),
      detail: "average net per cycle",
      tone: "violet" as const,
    },
    {
      label: "Total deductions YTD",
      value: currencyFormatter.format(ytdDeductions),
      change: percentFormatter.format(deductionRate),
      detail: "effective deduction rate",
      tone: "amber" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ReportDownloadButton report="employee-payroll" />
      </div>

      {payrollData.source !== "database" && (
        <div className="rounded-[24px] border border-dashed border-primary/30 bg-primary/5 px-5 py-4 text-sm text-dark-5 dark:text-dark-6">
          Supabase payroll records are not available yet. Configure the database connection to load employee statements and document links here.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mb-6">
        <SectionCard
          title="Payroll documents"
          description="Open the latest statements, deposit notices, and year-to-date summaries."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-dark-5 dark:text-dark-6">
                    No payroll documents are available yet.
                  </TableCell>
                </TableRow>
              ) : (
                documents.map((document) => {
                  const isReady = document.href !== "#";

                  return (
                    <TableRow key={document.id}>
                      <TableCell>
                        <div className="font-semibold text-dark dark:text-white">
                          {document.name}
                        </div>
                        <div className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                          {document.category}
                        </div>
                      </TableCell>
                      <TableCell>{document.period}</TableCell>
                      <TableCell>{document.issuedOn}</TableCell>
                      <TableCell>
                        <StatusBadge tone={documentTone(document.status)}>
                          {document.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isReady ? (
                          <a
                            href={document.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex rounded-full border border-stroke px-3 py-1.5 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 dark:hover:border-primary dark:hover:text-white"
                          >
                            Open
                          </a>
                        ) : (
                          <span className="inline-flex rounded-full border border-dashed border-stroke px-3 py-1.5 text-sm font-semibold text-dark-5 dark:border-dark-3 dark:text-dark-6">
                            Pending
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
        <div className="grid gap-6">
          <SectionCard
            title="Payroll profile"
            description={
              payrollData.source === "database"
                ? "Synced from your employee profile and payroll records."
                : "Waiting for Supabase payroll records and employee profile data."
            }
            action={
              <StatusBadge tone="slate">{employee.payFrequency}</StatusBadge>
            }
            >
            <div className="rounded-[24px] bg-slate-950 p-5 text-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-300">{employee.role}</p>
                  <h2 className="mt-1 text-2xl font-bold text-white">
                    {employee.name}
                  </h2>
                </div>
                <StatusBadge
                  tone={
                    employee.directDepositAccount === "Direct deposit not configured"
                      ? "amber"
                      : "green"
                  }
                >
                  {employee.directDepositAccount === "Direct deposit not configured"
                    ? "Deposit setup needed"
                    : "Direct deposit active"}
                </StatusBadge>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <KeyDetail label="Employee Number" value={employee.employeeNumber} />
                <KeyDetail label="Department" value={employee.department} />
                <KeyDetail label="Manager" value={employee.manager} />
                <KeyDetail
                  label="Deposit Account"
                  value={employee.directDepositAccount}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Current pay statement"
            description={
              currentStatement
                ? currentStatement.status === "Scheduled"
                  ? `${currentStatement.period} • deposit scheduled for ${currentStatement.payDate}`
                  : `${currentStatement.period} • paid on ${currentStatement.payDate}`
                : "Payroll statement details will appear after the first synced cycle."
            }
            action={
              <StatusBadge
                tone={
                  employee.directDepositAccount === "Direct deposit not configured"
                    ? "amber"
                    : "green"
                }
              >
                {employee.directDepositAccount === "Direct deposit not configured"
                  ? "Deposit info needed"
                  : "Direct deposit active"}
              </StatusBadge>
            }
            >
            {currentStatement ? (
              <div className="rounded-[24px] bg-slate-950 p-5 text-white">
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyLine label="Statement pay" value={currentStatement.gross} />
                  <MoneyLine
                    label="Hourly rate"
                    value={currentStatement.hourlyRate}
                  />
                  <MoneyLine
                    label="Paid hours"
                    value={currentStatement.paidHours}
                    suffix=" hrs"
                  />
                  <MoneyLine label="Bonus" value={currentStatement.bonus} />
                </div>

                <div className="mt-5 rounded-[20px] border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">
                      {currentStatement.status === "Scheduled"
                        ? "Expected net deposit"
                        : "Latest net paid"}
                    </span>
                    <span className="text-2xl font-bold text-white">
                      {currencyFormatter.format(currentStatement.net)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {currentStatement.status === "Scheduled"
                      ? `Funds will settle to ${employee.directDepositAccount} on ${currentStatement.payDate}.`
                      : `The latest posted payroll cycle closed on ${currentStatement.payDate}.`}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyPanel message="No payroll statement has been synced for this employee yet." />
            )}
          </SectionCard>

          <SectionCard
            title="Year-to-date snapshot"
            description={
              latestPaidStatement
                ? `Running totals through ${latestPaidStatement.payDate}`
                : "Totals will update after the first paid payroll cycle."
            }
            >
            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryTile label="Gross YTD" value={currencyFormatter.format(ytdGross)} />
              <SummaryTile label="Net paid YTD" value={currencyFormatter.format(ytdNet)} />
              <SummaryTile label="Total bonus" value={currencyFormatter.format(totalBonus)} />
              <SummaryTile label="Paid cycles" value={`${paidStatements.length}`} />
            </div>
          </SectionCard>
        </div>


      <div className="mb-6">
        <SectionCard
          title="Recent earnings history"
          description="The latest payroll cycles available on the employee record."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Pay date</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-dark-5 dark:text-dark-6">
                    No payroll cycles are available yet.
                  </TableCell>
                </TableRow>
              ) : (
                statements.map((statement) => (
                  <TableRow key={statement.id}>
                    <TableCell className="font-semibold text-dark dark:text-white">
                      {statement.period}
                    </TableCell>
                    <TableCell>{statement.payDate}</TableCell>
                    <TableCell className="text-right text-dark dark:text-white">
                      {currencyFormatter.format(statement.gross)}
                    </TableCell>
                    <TableCell className="text-right text-dark-5 dark:text-dark-6">
                      {currencyFormatter.format(statement.deductions)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-green">
                      {currencyFormatter.format(statement.net)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={statement.status === "Paid" ? "green" : "amber"}
                      >
                        {statement.status}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
        <div className="grid gap-6">
          <SectionCard
            title="Deduction breakdown"
            description={`${percentFormatter.format(deductionRate)} of YTD gross is allocated to taxes and benefits.`}
            >
            {deductionBreakdown.length === 0 ? (
              <EmptyPanel message="Deduction categories will appear after paid payroll cycles are synced." />
            ) : (
              <div className="space-y-4">
                {deductionBreakdown.map((item) => {
                  const width =
                    ytdDeductions === 0 ? 0 : (item.amount / ytdDeductions) * 100;

                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-dark dark:text-white">
                          {item.label}
                        </span>
                        <span className="text-dark-5 dark:text-dark-6">
                          {currencyFormatter.format(item.amount)}
                        </span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-gray-2 dark:bg-dark-2">
                        <div
                          className={barToneClass(item.tone)}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Recent pay trend"
            description="Quick view of gross and net movement across recent payroll cycles."
            >
            {earningsTimeline.length === 0 ? (
              <EmptyPanel message="Pay trend data will render after the first payroll cycle is synced." />
            ) : (
              <div className="space-y-4">
                {earningsTimeline.map((cycle) => (
                  <div key={cycle.label}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-dark dark:text-white">
                        {cycle.label}
                      </span>
                      <span className="text-sm text-dark-5 dark:text-dark-6">
                        {compactCurrencyFormatter.format(cycle.net)} net
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-gray-2 dark:bg-dark-2">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-emerald-400"
                        style={{ width: `${(cycle.gross / maxTrendGross) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}

                {latestPaidStatement && (
                  <div className="rounded-[20px] border border-dashed border-stroke px-4 py-4 text-sm leading-6 text-dark-5 dark:border-dark-3 dark:text-dark-6">
                    Latest paid statement: {latestPaidStatement.period} with{" "}
                    {currencyFormatter.format(latestPaidStatement.net)} deposited on{" "}
                    {latestPaidStatement.payDate}.
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

  );
}

function documentTone(status: "Ready" | "Paid" | "Filed") {
  if (status === "Paid") {
    return "green";
  }

  if (status === "Filed") {
    return "blue";
  }

  return "amber";
}

function barToneClass(tone: "green" | "amber" | "blue" | "violet") {
  if (tone === "green") {
    return "h-2 rounded-full bg-emerald-500";
  }

  if (tone === "amber") {
    return "h-2 rounded-full bg-amber-500";
  }

  if (tone === "blue") {
    return "h-2 rounded-full bg-blue-500";
  }

  return "h-2 rounded-full bg-violet-500";
}

function KeyDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-100/80">
        {label}
      </div>
      <div className="mt-2 text-base font-semibold text-white">{value}</div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-stroke bg-gray-2/80 p-4 dark:border-dark-3 dark:bg-dark-2">
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-dark-5 dark:text-dark-6">
        {label}
      </div>
      <div className="mt-3 text-xl font-bold text-dark dark:text-white">
        {value}
      </div>
    </div>
  );
}

function MoneyLine(props: { label: string; value: number; suffix?: string }) {
  const isHours = props.suffix === " hrs";

  return (
    <div className="rounded-[18px] border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">
        {props.label}
      </div>
      <div className="mt-2 text-xl font-bold text-white">
        {isHours
          ? `${props.value.toFixed(1)}${props.suffix}`
          : currencyFormatter.format(props.value)}
      </div>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-stroke px-4 py-8 text-center text-sm leading-6 text-dark-5 dark:border-dark-3 dark:text-dark-6">
      {message}
    </div>
  );
}
