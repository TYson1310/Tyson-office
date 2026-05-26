import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { BankDetailsForm } from "@/components/employee/bank-details-form";
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
import { requireCurrentUser } from "@/lib/auth/session";
import { getEmployeePayrollPageData } from "@/lib/payroll/employee-payroll";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Profile",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric", timeZone: "UTC",
  }).format(value);
}

export default async function EmployeeProfilePage() {
  const auth = await requireCurrentUser();
  const payrollData = await getEmployeePayrollPageData(auth.user.id, auth.profile);
  const profile = auth.profile;
  const documents = payrollData.documents;
  const activeStatements = payrollData.statements.filter((statement) => statement.status === "Paid");
  const missingEmploymentDetails = [
    !profile?.department ? "Department" : null,
    !profile?.employee_number ? "Employee Number" : null,
    !profile?.pay_frequency ? "Pay Frequency" : null,
    !profile?.manager_name ? "Manager" : null,
  ].filter((value): value is string => value !== null);

  const profileMetrics = [
    {
      label: "Role",
      value: profile?.position_title ?? auth.appUser.role,
      change: profile?.department ?? "Department pending",
      detail: "current assignment",
      tone: "blue" as const,
    },
    {
      label: "Employee Number",
      value: profile?.employee_number ?? "Unassigned",
      change: profile?.status ?? "active",
      detail: "profile status",
      tone: "green" as const,
    },
    {
      label: "Documents",
      value: `${documents.length}`,
      change: "Supabase files",
      detail: "available records",
      tone: "violet" as const,
    },
    {
      label: "Paid Statements",
      value: `${activeStatements.length}`,
      change: payrollData.employee.nextPayDate,
      detail: "next pay date",
      tone: "amber" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="My Profile" />

      {payrollData.source !== "database" && (
        <div className="mb-6 rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Supabase employee records are not fully available. This page is showing the current live profile state only.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {profileMetrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.8fr_1fr]">
        <SectionCard title="Personal Information" description="Live employment details from your profile">
          <div className="rounded-lg border border-stroke p-6 dark:border-dark-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Full Name
                </label>
                <p className="text-dark-5 dark:text-dark-6">
                  {profile?.full_name ?? auth.appUser.name}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Position
                </label>
                <p className="text-dark-5 dark:text-dark-6">
                  {profile?.position_title ?? auth.appUser.role}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Department
                </label>
                <p className="text-dark-5 dark:text-dark-6">
                  {profile?.department ?? "Unassigned"}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Status
                </label>
                <p className="capitalize text-dark-5 dark:text-dark-6">
                  {profile?.status ?? auth.appUser.status}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Email
                </label>
                <p className="text-dark-5 dark:text-dark-6">{auth.appUser.email}</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Employee Number
                </label>
                <p className="text-dark-5 dark:text-dark-6">
                  {profile?.employee_number ?? "Not assigned"}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Pay Frequency
                </label>
                <p className="text-dark-5 dark:text-dark-6">
                  {profile?.pay_frequency ?? "Not assigned"}
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                  Account Created
                </label>
                <p className="text-dark-5 dark:text-dark-6">{formatDate(auth.appUser.createdAt)}</p>
              </div>
            </div>

            {missingEmploymentDetails.length > 0 ? (
              <div className="mt-6 rounded-lg border border-amber/20 bg-amber/10 px-4 py-3 text-sm text-amber">
                Still waiting on admin-assigned details: {missingEmploymentDetails.join(", ")}.
              </div>
            ) : null}
          </div>
        </SectionCard>

        <div className="grid gap-6">
          <SectionCard title="Reporting Line" description="Supervisor and payroll routing">
            <div className="rounded-lg border border-stroke p-4 dark:border-dark-3">
              <div className="mb-4">
                <label className="text-sm font-medium text-dark dark:text-white">
                  Manager
                </label>
                <p className="mt-1 text-dark-5 dark:text-dark-6">
                  {profile?.manager_name ?? "Unassigned"}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-dark dark:text-white">
                  Next Pay Date
                </label>
                <p className="mt-1 text-dark-5 dark:text-dark-6">
                  {payrollData.employee.nextPayDate}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Bank Details" description="Payroll deposit configuration">
            <BankDetailsForm
              initialBankName={profile?.bank_name}
              initialAccountLast4={profile?.bank_account_last4}
            />
          </SectionCard>
        </div>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Documents"
          description="Payroll and employment files linked to your profile"
        >
          {documents.length === 0 ? (
            <p className="text-sm text-dark-5 dark:text-dark-6">
              No payroll documents are available for this profile yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="font-medium text-dark dark:text-white">
                      {document.name}
                    </TableCell>
                    <TableCell>{document.category}</TableCell>
                    <TableCell>{document.issuedOn}</TableCell>
                    <TableCell>{document.status}</TableCell>
                    <TableCell className="text-right">
                      <a className="text-primary hover:underline" href={document.href}>
                        Open
                      </a>
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
