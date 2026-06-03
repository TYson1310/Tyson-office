import * as Icons from "../icons";
import { UserRole } from "@/types/erp.types";

type NavSubItem = {
  title: string;
  url: string;
  roles?: UserRole[];
};

type NavItem = {
  title: string;
  url?: string;
  icon: typeof Icons.HomeIcon;
  items: NavSubItem[];
  roles?: UserRole[];
};

type NavSection = {
  label: string;
  items: NavItem[];
  roles?: UserRole[];
};

export const NAV_DATA: NavSection[] = [
  {
    label: "ADMIN",
    roles: ["admin", "manager"],
    items: [
      {
        title: "Owner Center",
        url: "/admin/owner-command-center",
        icon: Icons.HomeIcon,
        items: [],
        roles: ["admin"],
      },
      {
        title: "Dashboard",
        url: "/admin/dashboard",
        icon: Icons.HomeIcon,
        items: [],
        roles: ["admin", "manager"],
      },
      {
        title: "Staff Management",
        url: "/admin/staff",
        icon: Icons.User,
        items: [],
        roles: ["admin", "manager"],
      },
      {
        title: "Shift Management",
        url: "/admin/shift-management",
        icon: Icons.Clock,
        items: [],
        roles: ["admin", "manager"],
      },
      {
        title: "Reports",
        url: "/admin/reports",
        icon: Icons.PieChart,
        items: [],
        roles: ["admin", "manager"],
      },
      {
        title: "Cash Vault",
        url: "/admin/bank-deposits",
        icon: Icons.Wallet,
        items: [],
        roles: ["admin", "manager"],
      },
    ],
  },
  {
    label: "DAILY OPERATIONS",
    roles: ["admin", "manager", "employee"],
    items: [
      {
        title: "Daily Sales",
        url: "/sales/daily-entry",
        icon: Icons.PieChart,
        items: [],
        roles: ["admin", "manager", "employee"],
      },
      {
        title: "Reconciliation",
        url: "/lottery/reconciliation",
        icon: Icons.Wallet,
        items: [],
        roles: ["admin", "manager", "employee"],
      },
    ],
  },
  {
    label: "WORKDAY",
    roles: ["manager", "employee"],
    items: [
      {
        title: "My Shift",
        url: "/shifts",
        icon: Icons.Clock,
        items: [],
        roles: ["manager", "employee"],
      },
      {
        title: "My Profile",
        url: "/employee/profile",
        icon: Icons.User,
        items: [],
        roles: ["manager", "employee"],
      },
      {
        title: "My Payroll",
        url: "/employee/payroll",
        icon: Icons.Wallet,
        items: [],
        roles: ["manager", "employee"],
      },
    ],
  },
  {
    label: "Lottery",
    roles: ["admin", "manager", "employee"],
    items: [
      {
        title: "Dashboard",
        url: "/lottery",
        icon: Icons.HomeIcon,
        items: [],
        roles: ["admin", "manager", "employee"],
      },
      {
        title: "Delivery Scan",
        url: "/scratch-cards/delivery-scan",
        icon: Icons.Table,
        items: [],
        roles: ["admin", "manager", "employee"],
      },
      {
        title: "Scratch Cards",
        url: "/scratch-cards/audit",
        icon: Icons.FourCircle,
        items: [],
        roles: ["admin", "manager", "employee"],
      },
      {
        title: "EFT",
        url: "/lottery/eft",
        icon: Icons.Wallet,
        items: [],
        roles: ["admin", "manager", "employee"],
      },
      {
        title: "Cash Advances",
        url: "/lottery/cash-advances",
        icon: Icons.Wallet,
        items: [],
        roles: ["admin", "manager"],
      },
      {
        title: "Reports",
        url: "/lottery/reports",
        icon: Icons.PieChart,
        items: [],
        roles: ["admin", "manager", "employee"],
      },
    ],
  },
  {
    label: "MANAGEMENT",
    roles: ["admin", "manager"],
    items: [
      {
        title: "Vendors",
        icon: Icons.Alphabet,
        items: [
          {
            title: "Directory",
            url: "/vendors/directory",
            roles: ["admin", "manager"],
          },
          {
            title: "Invoices",
            url: "/vendors/invoices",
            roles: ["admin", "manager"],
          },
          {
            title: "Inventory",
            url: "/inventory",
            roles: ["admin", "manager"],
          },
        ],
        roles: ["admin", "manager"],
      },
      {
        title: "Payroll",
        url: "/payroll",
        icon: Icons.Wallet,
        items: [],
        roles: ["admin", "manager"],
      },
      {
        title: "Expenses",
        url: "/admin/expenses",
        icon: Icons.Wallet,
        items: [],
        roles: ["admin", "manager"],
      },
      {
        title: "Approvals",
        url: "/admin/approvals",
        icon: Icons.HistoryIcon,
        items: [],
        roles: ["admin", "manager"],
      },
    ],
  },
  {
    label: "TRACKING",
    roles: ["admin"],
    items: [
      {
        title: "Login Tracking",
        url: "/admin/login-tracking",
        icon: Icons.HistoryIcon,
        items: [],
        roles: ["admin"],
      },
      {
        title: "Audit Logs",
        url: "/admin/audit-logs",
        icon: Icons.HistoryIcon,
        items: [],
        roles: ["admin"],
      },
      {
        title: "Store Health",
        url: "/admin/store-health",
        icon: Icons.HistoryIcon,
        items: [],
        roles: ["admin"],
      },
      {
        title: "Loss Prevention",
        url: "/admin/loss-prevention",
        icon: Icons.HistoryIcon,
        items: [],
        roles: ["admin"],
      },
      {
        title: "Daily Sales Logs",
        url: "/admin/sales-logs",
        icon: Icons.HistoryIcon,
        items: [],
        roles: ["admin"],
      },
    ],
  },
];
