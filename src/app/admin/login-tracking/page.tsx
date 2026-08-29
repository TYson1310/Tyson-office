import { redirect } from "next/navigation";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
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
import { formatDateTime } from "@/lib/date-time";
import { getPostLoginRedirectPath } from "@/lib/auth/redirect-path";
import { listLoginActivity, type LoginActivityRecord } from "@/lib/auth/login-activity";
import { requireCurrentUser } from "@/lib/auth/session";

function formatRoleLabel(role: string) {
  return role
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDeviceTypeLabel(deviceType: LoginActivityRecord["deviceType"]) {
  if (deviceType === "unknown") {
    return "Unknown";
  }

  return deviceType.charAt(0).toUpperCase() + deviceType.slice(1);
}

function formatDeviceLabel(session: LoginActivityRecord) {
  return session.deviceName ?? formatDeviceTypeLabel(session.deviceType);
}

function formatBrowserLabel(session: LoginActivityRecord) {
  if (session.browserName && session.browserVersion) {
    return `${session.browserName} ${session.browserVersion}`;
  }

  return session.browserName ?? "Unknown Browser";
}

function formatOperatingSystemLabel(session: LoginActivityRecord) {
  if (session.osName && session.osVersion) {
    return `${session.osName} ${session.osVersion}`;
  }

  return session.osName ?? "Unknown OS";
}

export default async function LoginTrackingPage() {
  const auth = await requireCurrentUser();

  if (auth.appUser.role !== "admin") {
    redirect(
      getPostLoginRedirectPath(
        auth.appUser.role,
        auth.appUser.storeKey,
        auth.appUser.permissions,
      ),
    );
  }

  const activity = await listLoginActivity();
  const sessions = activity.sessions;
  const metrics = [
    {
      label: "Sessions",
      value: sessions.length,
      change: "Successful",
      detail: "recorded sign-ins",
      tone: "blue" as const,
    },
    {
      label: "Accounts",
      value: new Set(sessions.map((session) => session.userId)).size,
      change: "Unique",
      detail: "users in recent activity",
      tone: "green" as const,
    },
    {
      label: "Desktop",
      value: sessions.filter((session) => session.deviceType === "desktop").length,
      change: "Endpoints",
      detail: "desktop-class sessions",
      tone: "slate" as const,
    },
    {
      label: "Mobile",
      value: sessions.filter((session) => session.deviceType === "mobile").length,
      change: "Endpoints",
      detail: "phone sign-ins",
      tone: "violet" as const,
    },
  ];

  return (
    <>
      <Breadcrumb pageName="Login Tracking" />

      <div className="space-y-6">
        {activity.warning ? (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            {activity.warning}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <StatCard key={metric.label} {...metric} />
          ))}
        </div>

        <SectionCard
          title="Recent Login Activity"
          description="Successful sign-ins across all stores, including device, browser, OS, and source IP details."
        >
          {sessions.length === 0 ? (
            <p className="text-sm text-dark-5 dark:text-dark-6">
              No login activity has been recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Signed In</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Browser / OS</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      {formatDateTime(session.signedInAt, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {session.fullName}
                      </div>
                      <div className="text-xs text-dark-5 dark:text-dark-6">
                        {session.email}
                      </div>
                      <div className="text-xs text-dark-5 dark:text-dark-6">
                        {formatRoleLabel(session.role)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {session.assignedStoreName ??
                        session.assignedStoreKey ??
                        "Unassigned"}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark dark:text-white">
                        {formatDeviceLabel(session)}
                      </div>
                      <div className="text-xs text-dark-5 dark:text-dark-6">
                        {formatDeviceTypeLabel(session.deviceType)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{formatBrowserLabel(session)}</div>
                      <div className="text-xs text-dark-5 dark:text-dark-6">
                        {formatOperatingSystemLabel(session)}
                      </div>
                    </TableCell>
                    <TableCell>{session.ipAddress ?? "Unknown"}</TableCell>
                    <TableCell>
                      {formatDateTime(session.lastSeenAt, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
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
