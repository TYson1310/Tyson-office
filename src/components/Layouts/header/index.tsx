"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useStore } from "@/contexts/StoreContext";
import { BRAND } from "@/lib/brand";
import { createStoreHref } from "@/lib/store-query";
import { useSidebarContext } from "../sidebar/sidebar-context";
import { MenuIcon } from "./icons";
import { UserInfo } from "./user-info";

const headerCopy: Record<string, { title: string; subtitle: string }> = {
  "/": {
    title: "Store Overview",
    subtitle: "Track sales, stock health, deliveries, and team coverage.",
  },
  "/inventory": {
    title: "Inventory Control",
    subtitle: "Monitor stock, reorder pressure, and shelf coverage.",
  },
  "/payroll": {
    title: "Payroll Management",
    subtitle: "Review hours, approvals, deductions, and pay run readiness.",
  },
  "/admin/dashboard": {
    title: "Dashboard",
    subtitle: "High-level business KPIs, alerts, and system health.",
  },
  "/admin/owner-command-center": {
    title: "Owner Command Center",
    subtitle:
      "One-screen view of sales, cash, EFT, approvals, bills, payroll, and exceptions.",
  },
  "/admin/store-selection": {
    title: "Store Selection",
    subtitle: "Choose the active store workspace for this admin session.",
  },
  "/admin/store-health": {
    title: "Store Health",
    subtitle:
      "Check migrations, storage, backups, Supabase config, and active store data counts.",
  },
  "/admin/staff": {
    title: "Staff & Access",
    subtitle: "Manage employees, roles, and granular system permissions.",
  },
  "/admin/shift-management": {
    title: "Shift Management",
    subtitle:
      "Review live staff clock logs, verify completed shifts, and manage payroll hours.",
  },
  "/shifts": {
    title: "My Shift",
    subtitle:
      "Clock yourself in or out and track admin verification of your shift logs.",
  },
  "/admin/audit-logs": {
    title: "System Audit Logs",
    subtitle: "Traceable history of all administrative actions and changes.",
  },
  "/admin/login-tracking": {
    title: "Login Tracking",
    subtitle:
      "Review which accounts signed in, from which devices, and from where.",
  },
  "/admin/loss-prevention": {
    title: "Loss Prevention",
    subtitle:
      "Review cash gaps, sales edits, reconciliation variance, and sensitive report activity.",
  },
  "/admin/reports": {
    title: "Report Launcher",
    subtitle: "Centralized access to all business intelligence modules.",
  },
  "/admin/settings": {
    title: "Global Settings",
    subtitle: "Configure business info, tax rates, and security policies.",
  },
  "/daily-closeout": {
    title: "Daily Close Out",
    subtitle: "Complete Lottery EOD, count register cash, and review NRS data.",
  },
  "/lottery": {
    title: "Lottery",
    subtitle:
      "Review lottery cash status, payouts, and scratch pack backstock.",
  },
  "/scratch-cards/audit": {
    title: "Scratch Cards",
    subtitle:
      "View bin assignments, load sold-out packs, and return discontinued games.",
  },
  "/lottery/reconciliation": {
    title: "Lottery EOD Reconciliation",
    subtitle: "Match bin end tickets, terminal totals, payouts, and till cash.",
  },
  "/lottery/eft": {
    title: "Lottery EFT",
    subtitle:
      "Review auto-calculated EFT dues and the transactions behind them.",
  },
  "/lottery/reports": {
    title: "Lottery Reports",
    subtitle:
      "Track closeout trends, scratch game sales, payouts, and variance.",
  },
  "/vendors/directory": {
    title: "Vendor Directory",
    subtitle: "Maintain records for all suppliers and partners.",
  },
  "/employee/profile": {
    title: "Employee Dashboard",
    subtitle: "View your personal performance and basic shift info.",
  },
  "/employee/payroll": {
    title: "Pay & Earnings",
    subtitle:
      "Open pay documents, track deposits, and review year-to-date totals.",
  },
  "/admin/approvals": {
    title: "Payments Approvals",
    subtitle:
      "Approve or reject payments, settle disputes, and manage payment history.",
  },
  "/admin/expenses": {
    title: "Store Expenses",
    subtitle:
      "Manage Store Expenses, including expense categories, reports, and budgets.",
  },
  "/admin/sales-logs": {
    title: "Daily Sales",
    subtitle:
      "Log daily revenue totals and perform drawer reconciliation for the day.",
  },
  "/admin/bank-deposits": {
    title: "Cash Vault",
    subtitle: "Track store cash, lottery cash, advances, and deposits.",
  },
};

export function Header() {
  const { toggleSidebar, isMobile } = useSidebarContext();
  const pathname = usePathname();
  const { user } = useAuth();
  const { activeStore } = useStore();
  const storeId = activeStore?.storeKey ?? user?.storeKey;

  // Find the best match by checking for exact match first, then parent paths
  const copy = useMemo(() => {
    if (headerCopy[pathname]) return headerCopy[pathname];

    // Check for parent paths if no exact match (e.g., /reports/sales -> /reports)
    const segments = pathname.split("/").filter(Boolean);
    for (let i = segments.length - 1; i > 0; i--) {
      const subPath = "/" + segments.slice(0, i).join("/");
      if (headerCopy[subPath]) return headerCopy[subPath];
    }

    return headerCopy["/"];
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-white/70 px-3 py-3 shadow-[0_14px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:px-4 md:px-5 2xl:px-10">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-3">
        <div className="flex min-w-0 items-start gap-2 sm:gap-3">
          <button
            onClick={toggleSidebar}
            className="shrink-0 rounded-xl border border-slate-200 bg-white/80 px-2 py-1.5 text-slate-700 shadow-sm transition hover:border-teal-300 hover:text-teal-700 lg:hidden"
          >
            <MenuIcon />
            <span className="sr-only">Toggle Sidebar</span>
          </button>

          {isMobile ? (
            <Link
              href={createStoreHref("/", storeId)}
              className="hidden shrink-0 rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-teal-200 shadow-[0_12px_24px_rgba(15,23,42,0.16)] min-[360px]:inline-flex"
            >
              {BRAND.mark}
            </Link>
          ) : null}

          <div className="min-w-0 flex-1 lg:hidden">
            <div className="truncate pt-2 text-sm font-semibold text-slate-950 sm:text-base">
              {copy.title}
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 lg:block">
            <h1 className="font-satoshi mb-0.5 truncate text-2xl font-bold text-slate-950 xl:text-3xl">
              {copy.title}
            </h1>
            <p className="max-w-3xl text-sm font-medium text-slate-600 xl:text-base">
              {copy.subtitle}
            </p>
            {activeStore ? (
              <div className="mt-2 inline-flex max-w-full items-center rounded-full border border-teal-200 bg-teal-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-teal-800">
                <span className="truncate">{activeStore.name}</span>
              </div>
            ) : null}
          </div>

          <div className="ml-auto shrink-0">
            <UserInfo />
          </div>
        </div>

        <div className="min-w-0 lg:hidden">
          <p className="text-xs text-slate-600 sm:text-sm">{copy.subtitle}</p>
          {activeStore ? (
            <div className="mt-2 inline-flex max-w-full items-center rounded-full border border-teal-200 bg-teal-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-800 sm:text-xs">
              <span className="truncate">{activeStore.name}</span>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
