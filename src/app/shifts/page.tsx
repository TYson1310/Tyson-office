import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth/session";
import { SelfShiftPage } from "./self-shift-page";

export const metadata: Metadata = {
  title: "My Shift",
};

export const dynamic = "force-dynamic";

export default async function ShiftsPage() {
  const auth = await requireCurrentUser();

  if (auth.appUser.role === "admin") {
    redirect("/admin/shift-management");
  }

  return <SelfShiftPage />;
}
