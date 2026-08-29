import type { Metadata } from "next";
import { AdminOpsDashboard } from "@/components/dashboard/admin-ops-dashboard";

export const metadata: Metadata = {
  title: "Admin Dashboard",
};

export default function AdminDashboardPage() {
  return <AdminOpsDashboard />;
}
