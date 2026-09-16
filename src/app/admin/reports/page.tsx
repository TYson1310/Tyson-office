"use client";

import { useState, useEffect, useMemo } from "react";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { ReportDownloadButton } from "@/components/reports/report-download-button";
import type { ReportExportKey } from "@/lib/reports/export";
import {
  TrendingUp,
  Users,
  ShoppingCart,
  Calendar,
  Eye,
  Download,
  Ticket,
} from "lucide-react";

type ReportItem = {
  id: string;
  title: string;
  description: string;
  url: string;
  frequency: string;
  downloadKey?: ReportExportKey;
  downloadHref?: string;
};

type ReportCategory = {
  id: string;
  name: string;
  color: string;
  iconColor: string;
  icon: typeof TrendingUp;
  reports: ReportItem[];
};

const reportCategories: ReportCategory[] = [
  {
    id: "sales",
    name: "Sales Reports",
    color: "bg-blue-500/10",
    iconColor: "text-blue-600",
    icon: ShoppingCart,
    reports: [
      {
        id: "sales-daily",
        title: "Daily Sales Report",
        description:
          "Track daily revenue by payment method with reconciliation details.",
        url: "/reports/sales",
        frequency: "Daily",
        downloadKey: "sales" as ReportExportKey,
      },
      {
        id: "sales-trends",
        title: "Sales Trends Analytics",
        description:
          "Review recent sales trends and payment mix from recorded sales entries.",
        url: "/reports/sales",
        frequency: "Weekly",
        downloadKey: "sales" as ReportExportKey,
      },
      {
        id: "payment-breakdown",
        title: "Payment Method Breakdown",
        description:
          "Inspect current payment-method distribution from live sales data.",
        url: "/reports/sales",
        frequency: "Daily",
        downloadKey: "sales" as ReportExportKey,
      },
    ],
  },
  {
    id: "lottery",
    name: "Lottery Reports",
    color: "bg-emerald-500/10",
    iconColor: "text-emerald-600",
    icon: Ticket,
    reports: [
      {
        id: "lottery-closeout",
        title: "Lottery Closeout Report",
        description:
          "Review lottery revenue, payouts, short/over, and scratch game movement.",
        url: "/lottery/reports",
        frequency: "Daily",
        downloadKey: "lottery" as ReportExportKey,
      },
    ],
  },
  {
    id: "profit",
    name: "Profit & Financial Reports",
    color: "bg-green-500/10",
    iconColor: "text-green-600",
    icon: TrendingUp,
    reports: [
      {
        id: "profit-analysis",
        title: "Profit Analysis",
        description:
          "Review revenue, cost of goods, expenses, and net profit by month.",
        url: "/reports/profit",
        frequency: "Monthly",
        downloadKey: "profit" as ReportExportKey,
      },
      {
        id: "margin-analysis",
        title: "Margin Analysis",
        description:
          "Inspect live product margins and products below target margin.",
        url: "/reports/margin-analysis",
        frequency: "Weekly",
        downloadKey: "margin-analysis" as ReportExportKey,
      },
    ],
  },
  {
    id: "vendor",
    name: "Vendor & Supplier Reports",
    color: "bg-purple-500/10",
    iconColor: "text-purple-600",
    icon: Users,
    reports: [
      {
        id: "vendor-spending",
        title: "Vendor Spending Analysis",
        description:
          "Track spend, exposure, and supplier reliability from recorded vendor activity.",
        url: "/reports/vendor-analysis",
        frequency: "Weekly",
        downloadKey: "vendor-analysis" as ReportExportKey,
      },
      {
        id: "vendor-ledger",
        title: "Vendor Statement Ledger",
        description:
          "Export the raw supplier ledger with invoices, posted payments, approved adjustments, and running balances.",
        url: "/vendors/invoices",
        frequency: "On demand",
        downloadKey: "vendor-ledger" as ReportExportKey,
      },
    ],
  },
  {
    id: "payroll",
    name: "Payroll & HR Reports",
    color: "bg-orange-500/10",
    iconColor: "text-orange-600",
    icon: Users,
    reports: [
      {
        id: "payroll-analysis",
        title: "Payroll Cost Analysis",
        description:
          "Review pay statements, payroll cost, deductions, and net pay trends.",
        url: "/reports/payroll-analysis",
        frequency: "Weekly",
        downloadKey: "payroll-analysis" as ReportExportKey,
      },
      {
        id: "employee-payroll",
        title: "Employee Payroll Workspace",
        description:
          "View employee payroll statements and linked payroll documents.",
        url: "/employee/payroll",
        frequency: "On demand",
        downloadKey: "employee-payroll" as ReportExportKey,
      },
    ],
  },
];

const REPORTS_CATEGORY_STORAGE_KEY = "reports:selectedCategory:v1";
const LEGACY_REPORTS_CATEGORY_STORAGE_KEY = "reports:selectedCategory";

export default function AdminReportsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    () => {
      try {
        const stored =
          localStorage.getItem(REPORTS_CATEGORY_STORAGE_KEY) ||
          localStorage.getItem(LEGACY_REPORTS_CATEGORY_STORAGE_KEY);

        if (stored && stored.length > 0) {
          if (stored !== localStorage.getItem(REPORTS_CATEGORY_STORAGE_KEY)) {
            localStorage.setItem(REPORTS_CATEGORY_STORAGE_KEY, stored);
            localStorage.removeItem(LEGACY_REPORTS_CATEGORY_STORAGE_KEY);
          }
          return stored;
        }

        return null;
      } catch {
        return null;
      }
    },
  );
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    try {
      if (selectedCategory) {
        localStorage.setItem(REPORTS_CATEGORY_STORAGE_KEY, selectedCategory);
        localStorage.removeItem(LEGACY_REPORTS_CATEGORY_STORAGE_KEY);
      } else {
        localStorage.removeItem(REPORTS_CATEGORY_STORAGE_KEY);
        localStorage.removeItem(LEGACY_REPORTS_CATEGORY_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, [selectedCategory]);

  const allReports = reportCategories.flatMap((category) => category.reports);

  const filteredReports = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (term) {
      return allReports.filter(
        (r) =>
          r.title.toLowerCase().includes(term) ||
          r.description.toLowerCase().includes(term),
      );
    }

    if (selectedCategory) {
      const category = reportCategories.find((c) => c.id === selectedCategory);
      return category ? category.reports : [];
    }

    return allReports;
  }, [allReports, searchTerm, selectedCategory]);

  return (
    <>
      <Breadcrumb pageName="Reports" />

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setSelectedCategory(null);
                  setSearchTerm("");
                }}
                className={`font-satoshi rounded-full px-4 py-2 text-sm font-semibold transition ${
                  selectedCategory === null
                    ? "bg-primary text-white shadow-lg"
                    : "app-secondary-button"
                }`}
              >
                All Reports ({allReports.length})
              </button>

              {reportCategories.map((c) => {
                const Icon = c.icon;
                const active = selectedCategory === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCategory(active ? null : c.id)}
                    className={`font-satoshi flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "bg-primary text-white shadow-lg"
                        : "app-secondary-button"
                    }`}
                    aria-pressed={active}
                  >
                    <Icon className={`${c.iconColor} h-4 w-4`} />
                    {c.name}
                  </button>
                );
              })}
            </div>

            <section className="mt-8">
              {filteredReports.length === 0 ? (
                <div className="app-empty-state rounded-[28px] p-12">
                  <p className="font-satoshi text-slate-500">
                    No reports match your search.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {filteredReports.map((report) => (
                    <article
                      key={report.id}
                      className="app-surface-card p-6 transition hover:-translate-y-0.5 hover:shadow-[0_22px_56px_rgba(15,23,42,0.12)]"
                    >
                      <h3 className="font-satoshi text-lg font-bold text-slate-950">
                        {report.title}
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        {report.description}
                      </p>

                      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {report.frequency}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Eye className="h-3.5 w-3.5" />
                            Live
                          </span>
                        </div>

                        <div className="flex w-full items-center gap-3 sm:w-auto">
                          <a
                            href={report.url}
                            className="inline-flex flex-1 items-center justify-center rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 sm:flex-none"
                          >
                            View
                          </a>
                          {report.downloadHref ? (
                            <a
                              href={report.downloadHref}
                              className="app-icon-button shrink-0"
                              aria-label={`Download ${report.title}`}
                              title={`Download ${report.title}`}
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          ) : report.downloadKey ? (
                            <ReportDownloadButton
                              report={report.downloadKey}
                              label={`Download ${report.title}`}
                              iconOnly
                              className="shrink-0"
                            />
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
