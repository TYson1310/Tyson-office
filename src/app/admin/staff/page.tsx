"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Breadcrumb from "@/components/Breadcrumbs/Breadcrumb";
import { SectionCard } from "@/components/erp/section-card";
import { StatCard } from "@/components/erp/stat-card";
import { StatusBadge } from "@/components/erp/status-badge";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useAuth } from "@/contexts/AuthContext";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { useStore } from "@/contexts/StoreContext";
import { canAccessPath } from "@/lib/auth/route-access";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";
import { canManagePayrollAdjustments } from "@/lib/payroll/permissions";
import type { PayrollDeductions, SupportedUserRole } from "@/types/erp.types";
import {
  DEFAULT_PAYROLL_PAYMENT_METHOD,
  PAYROLL_PAYMENT_METHOD_OPTIONS,
} from "@/lib/payroll/payment-methods";
import {
  formatPayrollDateLabel,
  type PayrollFrequency,
} from "@/lib/payroll/payroll-periods";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  AlertCircle,
  Check,
  CheckCircle,
  DollarSign,
  Edit2,
  Plus,
  Shield,
  Trash2,
  Users,
} from "lucide-react";

type StaffRole = SupportedUserRole;

type StaffStatus = "active" | "inactive" | "on-leave";

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  joinDate: string;
  hourlyRate: number;
  phone: string;
  permissions: string[];
  department: string;
  position: string;
  managerName: string;
  employeeNumber: string;
  payFrequency: string;
};

type CredentialsNotice = {
  name: string;
  email: string;
  temporaryPassword: string;
};

type FormState = {
  name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  hourlyRate: number;
  phone: string;
  permissions: string[];
  department: string;
  position: string;
  managerName: string;
  employeeNumber: string;
  payFrequency: string;
  password: string;
  confirmPassword: string;
};

type PayrollRunAvailability = {
  frequency: PayrollFrequency;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  nextAvailableOn: string;
  isLocked: boolean;
  processedCount: number;
  lockReason: string | null;
  isCustomRange?: boolean;
  pendingShiftCount?: number;
  pendingEmployeeCount?: number;
  warningMessage?: string | null;
};

type PayrollRunStatusMap = Record<PayrollFrequency, PayrollRunAvailability>;

type PayrollRunSummary = PayrollRunAvailability & {
  employeeCount: number;
  totalGrossPay: number;
  totalNetPay: number;
};

type DeductionFormState = {
  incomeTax: string;
  socialSecurity: string;
  healthInsurance: string;
  employeeAdvance: string;
  other: string;
};

type PayrollAdjustmentFormState = {
  bonusAmount: string;
  deductions: DeductionFormState;
};

type PayrollRunFormState = PayrollAdjustmentFormState & {
  useCustomRange: boolean;
  periodLabel: string;
  periodStartDate: string;
  periodEndDate: string;
  paymentMethod: (typeof PAYROLL_PAYMENT_METHOD_OPTIONS)[number]["value"];
};

type OffCyclePayrollStatus = "draft" | "processed" | "paid";

type OffCyclePayrollFormState = PayrollAdjustmentFormState & {
  periodLabel: string;
  periodStartDate: string;
  periodEndDate: string;
  payDate: string;
  paymentMethod: (typeof PAYROLL_PAYMENT_METHOD_OPTIONS)[number]["value"];
  status: OffCyclePayrollStatus;
  notes: string;
};

type OffCyclePayrollSummary = {
  employeeName: string;
  period: string;
  payDate: string;
  grossPayTotal: number;
  netPay: number;
  status: "draft" | "processed" | "paid" | "archived";
};

const PERMISSION_GROUPS = [
  {
    label: "Management",
    permissions: [
      "view:dashboard",
      "view:staff",
      "view:shifts",
      "view:inventory",
      "view:vendors",
      "view:expenses",
      "view:bank_deposits",
      "view:approvals",
      "view:products",
      "view:reports",
      "view:managed_payroll",
    ],
  },
  {
    label: "Sales",
    permissions: ["view:sales", "create:sales"],
  },
  {
    label: "Lottery",
    permissions: [
      "view:lottery",
      "view:scratch_delivery",
      "view:scratch_cards",
      "view:lottery_reconciliation",
      "view:lottery_eft",
      "view:lottery_reports",
    ],
  },
  {
    label: "Employee",
    permissions: [
      "view:profile",
      "view:schedule",
      "view:payroll",
      "view:performance",
    ],
  },
  {
    label: "Advanced",
    permissions: [
      "view:orders",
      "view:suppliers",
      "view:financials",
      "update:inventory",
      "manage:payroll_adjustments",
    ],
  },
] as const;
const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.permissions);

const ROLE_PERMISSIONS: Record<
  StaffRole,
  { label: string; description: string; permissions: string[]; color: string }
> = {
  admin: {
    label: "Owner",
    description: "Full system access and store ownership controls",
    permissions: ["*"],
    color: "#5750F1",
  },
  manager: {
    label: "Manager",
    description: "Management and operations access",
    permissions: [
      "view:dashboard",
      "view:staff",
      "view:shifts",
      "view:vendors",
      "view:inventory",
      "view:payroll",
      "view:reports",
      "view:profile",
      "view:schedule",
      "view:sales",
      "create:sales",
      "view:lottery",
      "view:scratch_delivery",
      "view:scratch_cards",
      "view:lottery_reconciliation",
      "view:lottery_eft",
      "view:lottery_reports",
      "view:expenses",
      "view:bank_deposits",
      "view:approvals",
      "view:products",
      "manage:payroll_adjustments",
    ],
    color: "#FF6B35",
  },
  employee: {
    label: "Staff",
    description: "Clock in, payroll, profile, and day-to-day sales access",
    permissions: [
      "view:profile",
      "view:schedule",
      "view:payroll",
      "view:performance",
      "view:sales",
      "create:sales",
      "view:lottery",
      "view:scratch_delivery",
      "view:scratch_cards",
      "view:lottery_reconciliation",
      "view:lottery_eft",
      "view:lottery_reports",
    ],
    color: "#9C27B0",
  },
};

const DEFAULT_FORM_STATE: FormState = {
  name: "",
  email: "",
  role: "employee",
  status: "active",
  hourlyRate: 0,
  phone: "",
  permissions: [...ROLE_PERMISSIONS.employee.permissions],
  department: "",
  position: "",
  managerName: "",
  employeeNumber: "",
  payFrequency: "",
  password: "",
  confirmPassword: "",
};

const DEFAULT_PAYROLL_FREQUENCY: PayrollFrequency = "weekly";

function formatPermission(permission: string) {
  if (permission === "*") {
    return "Full access";
  }

  return permission.replace(/[:_]/g, " ");
}

function formatPayrollCurrency(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function getTodayDateValue(timeZone = "UTC") {
  return getTodayIsoDateInTimeZone(timeZone);
}

function buildOffCyclePeriodLabel(startDate: string, endDate: string) {
  return `Off-cycle payroll (${formatPayrollDateLabel(startDate)} - ${formatPayrollDateLabel(endDate)})`;
}

function buildPayrollRunPeriodLabel(startDate: string, endDate: string) {
  return `Payroll run (${formatPayrollDateLabel(startDate)} - ${formatPayrollDateLabel(endDate)})`;
}

function buildEmptyDeductionFormState(): DeductionFormState {
  return {
    incomeTax: "",
    socialSecurity: "",
    healthInsurance: "",
    employeeAdvance: "",
    other: "",
  };
}

function toPayrollAdjustmentAmount(value: string) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.max(normalized, 0) : 0;
}

function buildPayrollDeductions(
  deductions: DeductionFormState,
): PayrollDeductions {
  const incomeTax = toPayrollAdjustmentAmount(deductions.incomeTax);
  const socialSecurity = toPayrollAdjustmentAmount(deductions.socialSecurity);
  const healthInsurance = toPayrollAdjustmentAmount(deductions.healthInsurance);
  const employeeAdvance = toPayrollAdjustmentAmount(deductions.employeeAdvance);
  const other = toPayrollAdjustmentAmount(deductions.other);

  return {
    incomeTax,
    socialSecurity,
    healthInsurance,
    employeeAdvance,
    other,
    total:
      incomeTax + socialSecurity + healthInsurance + employeeAdvance + other,
  };
}

function buildDefaultPayrollRunForm(timeZone = "UTC"): PayrollRunFormState {
  const today = getTodayDateValue(timeZone);

  return {
    bonusAmount: "",
    deductions: buildEmptyDeductionFormState(),
    useCustomRange: false,
    periodLabel: buildPayrollRunPeriodLabel(today, today),
    periodStartDate: today,
    periodEndDate: today,
    paymentMethod: DEFAULT_PAYROLL_PAYMENT_METHOD,
  };
}

function buildDefaultOffCyclePayrollForm(
  timeZone = "UTC",
): OffCyclePayrollFormState {
  const today = getTodayDateValue(timeZone);

  return {
    bonusAmount: "",
    deductions: buildEmptyDeductionFormState(),
    periodLabel: buildOffCyclePeriodLabel(today, today),
    periodStartDate: today,
    periodEndDate: today,
    payDate: today,
    paymentMethod: DEFAULT_PAYROLL_PAYMENT_METHOD,
    status: "processed",
    notes: "",
  };
}

function formatOffCycleStatusLabel(
  status: OffCyclePayrollStatus | OffCyclePayrollSummary["status"],
) {
  if (status === "processed") {
    return "Scheduled";
  }

  if (status === "paid") {
    return "Paid";
  }

  if (status === "archived") {
    return "Archived";
  }

  return "Draft";
}

export default function StaffManagementPage() {
  const router = useRouter();
  const { notify } = useAppNotifications();
  const { user } = useAuth();
  const {
    activeStore,
    isAdmin,
    isLoading: isStoreLoading,
    needsSelection,
  } = useStore();
  const activeStoreTimeZone = activeStore?.timeZone ?? "UTC";
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [showRoleManager, setShowRoleManager] = useState(false);
  const [selectedPayrollMember, setSelectedPayrollMember] =
    useState<StaffMember | null>(null);
  const [payrollMode, setPayrollMode] = useState<"run" | "offcycle">("run");
  const [payrollStatus, setPayrollStatus] = useState<
    "idle" | "processing" | "completed"
  >("idle");
  const [payrollFrequency, setPayrollFrequency] = useState<PayrollFrequency>(
    DEFAULT_PAYROLL_FREQUENCY,
  );
  const [payrollRunStatus, setPayrollRunStatus] =
    useState<PayrollRunStatusMap | null>(null);
  const [payrollRunSummary, setPayrollRunSummary] =
    useState<PayrollRunSummary | null>(null);
  const [payrollRunForm, setPayrollRunForm] = useState<PayrollRunFormState>(
    buildDefaultPayrollRunForm(activeStoreTimeZone),
  );
  const [offCyclePayrollForm, setOffCyclePayrollForm] =
    useState<OffCyclePayrollFormState>(
      buildDefaultOffCyclePayrollForm(activeStoreTimeZone),
    );
  const [offCyclePayrollSummary, setOffCyclePayrollSummary] =
    useState<OffCyclePayrollSummary | null>(null);
  const [isLoadingPayrollRunStatus, setIsLoadingPayrollRunStatus] =
    useState(false);
  const [editingMember, setEditingMember] = useState<StaffMember | null>(null);
  const [credentialsNotice, setCredentialsNotice] =
    useState<CredentialsNotice | null>(null);
  const [formData, setFormData] = useState<FormState>(DEFAULT_FORM_STATE);
  const canManagePayroll = canAccessPath(
    "/payroll",
    user?.role,
    user?.permissions,
  );

  const showNotification = useCallback(
    (type: "success" | "error" | "warning", message: string) => {
      notify({ type, message });
    },
    [notify],
  );

  const loadStaff = useCallback(async () => {
    if (!activeStore?.storeKey) {
      setStaff([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/employees", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load staff");
      }

      setStaff(payload);
    } catch (error) {
      showNotification(
        "error",
        error instanceof Error ? error.message : "Failed to load staff",
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeStore?.storeKey, showNotification]);

  useEffect(() => {
    if (!isStoreLoading && isAdmin && needsSelection) {
      router.replace("/admin/store-selection");
      return;
    }

    void loadStaff();
  }, [isAdmin, isStoreLoading, loadStaff, needsSelection, router]);

  const loadPayrollRunStatus = useCallback(
    async (employeeId?: string | null) => {
      if (!activeStore?.storeKey || !canManagePayroll) {
        setPayrollRunStatus(null);
        return;
      }

      setIsLoadingPayrollRunStatus(true);

      try {
        const params = new URLSearchParams();
        params.set("type", "run_status");

        if (employeeId) {
          params.set("employeeId", employeeId);
        }

        const response = await fetch(`/api/payroll?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload.message ?? "Failed to load payroll term status",
          );
        }

        setPayrollRunStatus(payload);
      } catch (error) {
        setPayrollRunStatus(null);
        showNotification(
          "error",
          error instanceof Error
            ? error.message
            : "Failed to load payroll term status",
        );
      } finally {
        setIsLoadingPayrollRunStatus(false);
      }
    },
    [activeStore?.storeKey, canManagePayroll, showNotification],
  );

  function handleOpenModal(member?: StaffMember) {
    setCredentialsNotice(null);

    if (member) {
      setEditingMember(member);
      setFormData({
        name: member.name,
        email: member.email,
        role: member.role,
        status: member.status,
        hourlyRate: member.hourlyRate,
        phone: member.phone,
        permissions: [...member.permissions],
        department: member.department,
        position: member.position,
        managerName: member.managerName,
        employeeNumber: member.employeeNumber,
        payFrequency: member.payFrequency,
        password: "",
        confirmPassword: "",
      });
    } else {
      setEditingMember(null);
      setFormData(DEFAULT_FORM_STATE);
    }

    setShowModal(true);
  }

  function handleCloseModal() {
    if (isSubmitting) {
      return;
    }

    setShowModal(false);
    setEditingMember(null);
    setFormData(DEFAULT_FORM_STATE);
  }

  function handleRoleChange(role: StaffRole) {
    setFormData((current) => ({
      ...current,
      role,
      permissions: [...ROLE_PERMISSIONS[role].permissions],
    }));
  }

  function togglePermission(permission: string) {
    if (formData.role === "admin") {
      return;
    }

    setFormData((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((entry) => entry !== permission)
        : [...current.permissions, permission],
    }));
  }

  async function handleSaveMember() {
    if (!formData.name.trim() || !formData.email.trim()) {
      showNotification("error", "Please fill in the required fields.");
      return;
    }

    const requestedPassword =
      !editingMember && isAdmin ? formData.password.trim() : "";

    if (requestedPassword.length > 0) {
      if (requestedPassword.length < 8) {
        showNotification(
          "error",
          "Password must be at least 8 characters long.",
        );
        return;
      }
    }

    setIsSubmitting(true);
    setCredentialsNotice(null);

    try {
      const response = await fetch("/api/employees", {
        method: editingMember ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editingMember?.id,
          fullName: formData.name.trim(),
          email: formData.email.trim(),
          role: formData.role,
          status: formData.status,
          hourlyRate: formData.hourlyRate,
          phone: formData.phone.trim(),
          permissions: formData.permissions,
          department: formData.department.trim(),
          position: formData.position.trim(),
          managerName: formData.managerName.trim(),
          employeeNumber: formData.employeeNumber.trim(),
          payFrequency: formData.payFrequency.trim(),
          password: requestedPassword || undefined,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save staff member");
      }

      if (!editingMember && payload.temporaryPassword) {
        setCredentialsNotice({
          name: payload.employee.name,
          email: payload.employee.email,
          temporaryPassword: payload.temporaryPassword,
        });
      }

      await loadStaff();
      handleCloseModal();
      showNotification(
        "success",
        editingMember
          ? `Updated ${formData.name} successfully.`
          : `Created ${formData.name} and provisioned a login.`,
      );
    } catch (error) {
      showNotification(
        "error",
        error instanceof Error ? error.message : "Failed to save staff member",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteMember(member: StaffMember) {
    if (!window.confirm(`Deactivate ${member.name} and revoke their login?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/employees?id=${member.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to deactivate staff member");
      }

      await loadStaff();
      showNotification(
        "success",
        `${member.name} was deactivated successfully.`,
      );
    } catch (error) {
      showNotification(
        "error",
        error instanceof Error
          ? error.message
          : "Failed to deactivate staff member",
      );
    }
  }

  function handleOpenPayrollModal(member?: StaffMember) {
    if (!canManagePayroll) {
      showNotification(
        "error",
        "You only have access to your own payroll records.",
      );
      return;
    }

    if (!member && staff.length === 0) {
      showNotification(
        "warning",
        "No staff records are available for payroll.",
      );
      return;
    }

    setSelectedPayrollMember(member ?? null);
    setPayrollMode(member ? "offcycle" : "run");
    setPayrollStatus("idle");
    setPayrollFrequency(DEFAULT_PAYROLL_FREQUENCY);
    setPayrollRunSummary(null);
    setPayrollRunForm(buildDefaultPayrollRunForm(activeStoreTimeZone));
    setOffCyclePayrollForm(
      buildDefaultOffCyclePayrollForm(activeStoreTimeZone),
    );
    setOffCyclePayrollSummary(null);
    setPayrollRunStatus(null);
    setShowPayrollModal(true);
  }

  function handleClosePayrollModal() {
    if (payrollStatus === "processing") {
      return;
    }

    setShowPayrollModal(false);
    setSelectedPayrollMember(null);
    setPayrollMode("run");
    setPayrollStatus("idle");
    setPayrollFrequency(DEFAULT_PAYROLL_FREQUENCY);
    setPayrollRunStatus(null);
    setPayrollRunSummary(null);
    setPayrollRunForm(buildDefaultPayrollRunForm(activeStoreTimeZone));
    setOffCyclePayrollForm(
      buildDefaultOffCyclePayrollForm(activeStoreTimeZone),
    );
    setOffCyclePayrollSummary(null);
  }

  useEffect(() => {
    if (!showPayrollModal) {
      return;
    }

    void loadPayrollRunStatus(selectedPayrollMember?.id ?? null);
  }, [loadPayrollRunStatus, selectedPayrollMember, showPayrollModal]);

  async function handleRunPayroll() {
    if (
      payrollRunForm.useCustomRange &&
      (!payrollRunForm.periodStartDate || !payrollRunForm.periodEndDate)
    ) {
      showNotification("error", "Enter the payroll run date range.");
      return;
    }

    if (
      payrollRunForm.useCustomRange &&
      payrollRunForm.periodStartDate > payrollRunForm.periodEndDate
    ) {
      showNotification(
        "error",
        "Payroll run start date must be on or before the end date.",
      );
      return;
    }

    setPayrollStatus("processing");

    try {
      const requestBody: Record<string, unknown> = {
        type: "payroll_run",
        frequency: payrollFrequency,
        employeeId: selectedPayrollMember?.id,
        paymentMethod: payrollRunForm.paymentMethod,
      };

      if (payrollRunForm.useCustomRange) {
        requestBody.periodStartDate = payrollRunForm.periodStartDate;
        requestBody.periodEndDate = payrollRunForm.periodEndDate;
        requestBody.periodLabel =
          payrollRunForm.periodLabel.trim() ||
          buildPayrollRunPeriodLabel(
            payrollRunForm.periodStartDate,
            payrollRunForm.periodEndDate,
          );
      }

      if (selectedPayrollMember && canAddPayrollAdjustments) {
        const bonusAmount = toPayrollAdjustmentAmount(
          payrollRunForm.bonusAmount,
        );

        if (bonusAmount > 0 || payrollRunDeductions.total > 0) {
          requestBody.bonusAmount = bonusAmount;
          requestBody.deductions = payrollRunDeductions;
        }
      }

      const response = await fetch("/api/payroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to run payroll");
      }

      setPayrollRunSummary(payload.run ?? null);
      setOffCyclePayrollSummary(null);
      setPayrollStatus("completed");
      showNotification(
        "success",
        selectedPayrollMember
          ? `${payload.run?.periodLabel ?? "Payroll"} processed for ${selectedPayrollMember.name}.`
          : `${payload.run?.periodLabel ?? "Payroll"} processed successfully.`,
      );
      await loadPayrollRunStatus(selectedPayrollMember?.id ?? null);
    } catch (error) {
      setPayrollStatus("idle");
      showNotification(
        error instanceof Error && error.message.startsWith("Warning:")
          ? "warning"
          : "error",
        error instanceof Error ? error.message : "Failed to run payroll",
      );
    }
  }

  async function handleCreateOffCyclePayroll() {
    if (!selectedPayrollMember) {
      showNotification(
        "warning",
        "Select a staff member before creating off-cycle payroll.",
      );
      return;
    }

    if (
      !offCyclePayrollForm.periodStartDate ||
      !offCyclePayrollForm.periodEndDate ||
      !offCyclePayrollForm.payDate
    ) {
      showNotification("error", "Enter the pay period and pay date.");
      return;
    }

    if (
      offCyclePayrollForm.periodStartDate > offCyclePayrollForm.periodEndDate
    ) {
      showNotification(
        "error",
        "Period start date must be on or before the period end date.",
      );
      return;
    }

    const resolvedPeriodLabel =
      offCyclePayrollForm.periodLabel.trim() ||
      buildOffCyclePeriodLabel(
        offCyclePayrollForm.periodStartDate,
        offCyclePayrollForm.periodEndDate,
      );

    setPayrollStatus("processing");

    try {
      const offCycleBonusAmount = toPayrollAdjustmentAmount(
        offCyclePayrollForm.bonusAmount,
      );
      const shouldIncludeOffCycleAdjustments =
        canAddPayrollAdjustments &&
        (offCycleBonusAmount > 0 || offCyclePayrollDeductions.total > 0);

      const response = await fetch("/api/payroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "paystub",
          employeeId: selectedPayrollMember.id,
          period: resolvedPeriodLabel,
          periodStartDate: offCyclePayrollForm.periodStartDate,
          periodEndDate: offCyclePayrollForm.periodEndDate,
          paidAt: offCyclePayrollForm.payDate,
          paymentMethod: offCyclePayrollForm.paymentMethod,
          ...(shouldIncludeOffCycleAdjustments
            ? {
                bonusAmount: offCycleBonusAmount,
                deductions: offCyclePayrollDeductions,
              }
            : {}),
          status: offCyclePayrollForm.status,
          notes: offCyclePayrollForm.notes.trim() || undefined,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload.message ?? "Failed to create off-cycle payroll",
        );
      }

      setOffCyclePayrollSummary({
        employeeName: selectedPayrollMember.name,
        period: payload.period ?? resolvedPeriodLabel,
        payDate: payload.issuedAt ?? offCyclePayrollForm.payDate,
        grossPayTotal: Number(payload.grossPay?.total ?? 0),
        netPay: Number(payload.netPay ?? 0),
        status: payload.status ?? offCyclePayrollForm.status,
      });
      setPayrollRunSummary(null);
      setPayrollStatus("completed");
      router.refresh();
      showNotification(
        "success",
        `Off-cycle payroll created for ${selectedPayrollMember.name}.`,
      );
    } catch (error) {
      setPayrollStatus("idle");
      showNotification(
        error instanceof Error && error.message.startsWith("Warning:")
          ? "warning"
          : "error",
        error instanceof Error
          ? error.message
          : "Failed to create off-cycle payroll",
      );
    }
  }

  const activeCount = staff.filter(
    (member) => member.status === "active",
  ).length;
  const averageHourlyRate =
    staff.length === 0
      ? 0
      : staff.reduce((sum, member) => sum + member.hourlyRate, 0) /
        staff.length;
  const averagePermissions =
    staff.length === 0
      ? 0
      : Math.round(
          staff.reduce((sum, member) => sum + member.permissions.length, 0) /
            staff.length,
        );
  const selectedPayrollRunStatus = payrollRunStatus?.[payrollFrequency] ?? null;
  const supportsOffCyclePayroll = Boolean(selectedPayrollMember);
  const canAddPayrollAdjustments =
    canManagePayrollAdjustments(user?.role, user?.permissions) &&
    canManagePayroll;
  const payrollRunDeductions = buildPayrollDeductions(
    payrollRunForm.deductions,
  );
  const offCyclePayrollDeductions = buildPayrollDeductions(
    offCyclePayrollForm.deductions,
  );

  useEffect(() => {
    if (
      !showPayrollModal ||
      payrollMode !== "run" ||
      !selectedPayrollRunStatus
    ) {
      return;
    }

    setPayrollRunForm((current) =>
      current.useCustomRange
        ? current
        : {
            ...current,
            periodLabel: selectedPayrollRunStatus.periodLabel,
            periodStartDate: selectedPayrollRunStatus.periodStart,
            periodEndDate: selectedPayrollRunStatus.periodEnd,
          },
    );
  }, [payrollMode, selectedPayrollRunStatus, showPayrollModal]);

  return (
    <>
      <Breadcrumb pageName="Staff & Access Management" />

      {credentialsNotice && (
        <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-dark dark:text-white">
                Login Created for {credentialsNotice.name}
              </h3>
              <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                Share these credentials securely. The employee should change the
                password after first login.
              </p>
              <div className="mt-3 space-y-1 text-sm">
                <div>
                  <span className="font-medium text-dark dark:text-white">
                    Email:
                  </span>{" "}
                  {credentialsNotice.email}
                </div>
                <div>
                  <span className="font-medium text-dark dark:text-white">
                    Temporary password:
                  </span>{" "}
                  {credentialsNotice.temporaryPassword}
                </div>
              </div>
            </div>
            <button
              onClick={() => setCredentialsNotice(null)}
              className="rounded border border-stroke px-3 py-1 text-sm text-dark transition hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Total Staff",
            value: staff.length,
            change: "Directory",
            detail: "employees in current store",
            tone: "blue" as const,
            icon: <Users className="h-5 w-5" />,
          },
          {
            label: "Active Now",
            value: activeCount,
            change: "Available",
            detail: "currently active team members",
            tone: "green" as const,
            icon: <CheckCircle className="h-5 w-5" />,
          },
          {
            label: "Avg Hourly Rate",
            value: `$${averageHourlyRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr`,
            change: "Compensation",
            detail: "blended store labor rate",
            tone: "amber" as const,
            icon: <DollarSign className="h-5 w-5" />,
          },
          {
            label: "Avg Permissions",
            value: averagePermissions,
            change: "Access",
            detail: "average grants per employee",
            tone: "violet" as const,
            icon: <Shield className="h-5 w-5" />,
          },
        ].map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mb-6">
        <SectionCard
          title="Employee Directory"
          description="Manage staff details, system access, and login provisioning"
          action={
            <div className="flex gap-3">
              {canManagePayroll ? (
                <button
                  onClick={() => handleOpenPayrollModal()}
                  disabled={staff.length === 0}
                  className="flex items-center gap-2 rounded-lg border border-primary bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <DollarSign className="h-4 w-4" />
                  Run Payroll
                </button>
              ) : null}
              <button
                onClick={() => handleOpenModal()}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Add Member
              </button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <Table totalRows={staff.length}>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Member</TableHead>
                  <TableHead>Role & Access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hourly Rate</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      Loading staff records...
                    </TableCell>
                  </TableRow>
                ) : staff.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-dark-5 dark:text-dark-6"
                    >
                      No staff records are available. Add a member to create
                      their login and access profile.
                    </TableCell>
                  </TableRow>
                ) : (
                  staff.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-dark dark:text-white">
                            {member.name}
                          </p>
                          <p className="text-xs text-dark-5 dark:text-dark-6">
                            {member.email}
                          </p>
                          {member.phone ? (
                            <p className="text-xs text-dark-5 dark:text-dark-6">
                              {member.phone}
                            </p>
                          ) : null}
                          {member.employeeNumber ? (
                            <p className="text-xs text-dark-5 dark:text-dark-6">
                              #{member.employeeNumber}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span
                            className="inline-block w-fit rounded-full px-3 py-1 text-xs font-medium text-white"
                            style={{
                              backgroundColor:
                                ROLE_PERMISSIONS[member.role].color,
                            }}
                          >
                            {ROLE_PERMISSIONS[member.role].label}
                          </span>
                          <span className="text-[10px] font-bold uppercase text-dark-5 dark:text-dark-6">
                            {member.permissions.length} permissions
                          </span>
                          {member.department || member.payFrequency ? (
                            <span className="text-[10px] text-dark-5 dark:text-dark-6">
                              {[member.department, member.payFrequency]
                                .filter(Boolean)
                                .join(" • ")}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            member.status === "active"
                              ? "green"
                              : member.status === "inactive"
                                ? "red"
                                : "amber"
                          }
                        >
                          {member.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        $
                        {member.hourlyRate.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                        /hr
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canManagePayroll ? (
                            <button
                              onClick={() => handleOpenPayrollModal(member)}
                              className="app-icon-button app-success-icon-button"
                              title="Run individual payroll"
                              aria-label={`Run payroll for ${member.name}`}
                            >
                              <DollarSign className="h-4 w-4" />
                            </button>
                          ) : null}
                          <button
                            onClick={() => handleOpenModal(member)}
                            className="app-icon-button app-icon-button-accent"
                            title="Edit member"
                            aria-label={`Edit ${member.name}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => void handleDeleteMember(member)}
                            className="app-icon-button app-danger-icon-button"
                            title="Delete member"
                            aria-label={`Delete ${member.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      </div>
      <div className="grid gap-6">
        <SectionCard title="Role Overview" description="Access distribution">
          {staff.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stroke px-4 py-6 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
              No staff roles are assigned yet.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-3">
                {(
                  Object.entries(ROLE_PERMISSIONS) as Array<
                    [StaffRole, (typeof ROLE_PERMISSIONS)[StaffRole]]
                  >
                ).map(([role, config]) => {
                  const count = staff.filter(
                    (member) => member.role === role,
                  ).length;

                  if (count === 0) {
                    return null;
                  }

                  return (
                    <div key={role} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-dark-5 dark:text-dark-6">
                          {config.label}
                        </span>
                        <span className="font-semibold text-dark dark:text-white">
                          {count}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-2 dark:bg-dark-3">
                        <div
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: config.color,
                            width: `${(count / staff.length) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => setShowRoleManager(true)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-primary bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Shield className="h-4 w-4" />
                Review All Permissions
              </button>
            </div>
          )}
        </SectionCard>

        <div className="rounded-lg border border-blue/20 bg-blue/10 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
            <div>
              <h4 className="text-sm font-bold text-blue">
                Login Provisioning
              </h4>
              <p className="mt-1 text-xs text-blue/80">
                Creating a member now provisions a real Supabase Auth login and
                saves their access profile.
              </p>
            </div>
          </div>
        </div>
      </div>

      {showPayrollModal && (
        <ModalPortal>
          <div className="modal-shell z-50 bg-black/50">
            <div className="modal-card max-w-md rounded-lg bg-white dark:bg-dark-2">
              <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
                <h2 className="text-xl font-bold text-dark dark:text-white">
                  Payroll Processing
                </h2>
              </div>

              <div className="p-6 text-center">
                {payrollStatus === "idle" && (
                  <>
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                      <DollarSign className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="mb-2 text-lg font-bold text-dark dark:text-white">
                      {payrollMode === "offcycle" && selectedPayrollMember
                        ? `Off-Cycle Pay for ${selectedPayrollMember.name}`
                        : selectedPayrollMember
                          ? `Pay ${selectedPayrollMember.name}`
                          : "Run Payroll"}
                    </h3>
                    <p className="mb-6 text-sm text-dark-5 dark:text-dark-6">
                      {payrollMode === "offcycle" && selectedPayrollMember
                        ? `Create a custom paystub for a specific date range using finalized attendance only. Unreviewed shifts stay excluded until they are cleared.`
                        : selectedPayrollMember
                          ? `Payroll will use finalized attendance and ${selectedPayrollMember.name}'s hourly rate. Shifts with open exceptions stay out of pay calculations.`
                          : `Payroll will use finalized attendance for active staff. Shifts with open exceptions stay out of pay calculations.`}
                    </p>
                    {supportsOffCyclePayroll ? (
                      <div className="mb-6 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setPayrollMode("run")}
                          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                            payrollMode === "run"
                              ? "border-primary bg-primary text-white"
                              : "border-stroke text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                          }`}
                        >
                          Scheduled Run
                        </button>
                        <button
                          onClick={() => setPayrollMode("offcycle")}
                          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                            payrollMode === "offcycle"
                              ? "border-primary bg-primary text-white"
                              : "border-stroke text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                          }`}
                        >
                          Off-Cycle
                        </button>
                      </div>
                    ) : null}
                    {payrollMode === "run" ? (
                      <>
                        <div className="mb-6 grid grid-cols-2 gap-2">
                          {(["weekly", "monthly"] as PayrollFrequency[]).map(
                            (frequency) => (
                              <button
                                key={frequency}
                                onClick={() => setPayrollFrequency(frequency)}
                                disabled={isLoadingPayrollRunStatus}
                                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                                  payrollFrequency === frequency
                                    ? "border-primary bg-primary text-white"
                                    : "border-stroke text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                                } disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                {frequency === "weekly" ? "Weekly" : "Monthly"}
                              </button>
                            ),
                          )}
                        </div>
                        <label className="mb-4 flex items-center gap-2 text-left text-sm text-dark dark:text-white">
                          <input
                            type="checkbox"
                            checked={payrollRunForm.useCustomRange}
                            onChange={(event) =>
                              setPayrollRunForm((current) =>
                                event.target.checked ||
                                !selectedPayrollRunStatus
                                  ? {
                                      ...current,
                                      useCustomRange: event.target.checked,
                                    }
                                  : {
                                      ...current,
                                      useCustomRange: false,
                                      periodLabel:
                                        selectedPayrollRunStatus.periodLabel,
                                      periodStartDate:
                                        selectedPayrollRunStatus.periodStart,
                                      periodEndDate:
                                        selectedPayrollRunStatus.periodEnd,
                                    },
                              )
                            }
                            className="h-4 w-4 rounded border-stroke text-primary focus:ring-primary"
                          />
                          Use exact date range instead of the latest closed term
                        </label>
                        {payrollRunForm.useCustomRange ? (
                          <div className="mb-6 space-y-4 text-left">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                  Period start
                                </label>
                                <input
                                  type="date"
                                  value={payrollRunForm.periodStartDate}
                                  onChange={(event) =>
                                    setPayrollRunForm((current) => ({
                                      ...current,
                                      periodStartDate: event.target.value,
                                      periodLabel: buildPayrollRunPeriodLabel(
                                        event.target.value,
                                        current.periodEndDate,
                                      ),
                                    }))
                                  }
                                  className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                  Period end
                                </label>
                                <input
                                  type="date"
                                  value={payrollRunForm.periodEndDate}
                                  onChange={(event) =>
                                    setPayrollRunForm((current) => ({
                                      ...current,
                                      periodEndDate: event.target.value,
                                      periodLabel: buildPayrollRunPeriodLabel(
                                        current.periodStartDate,
                                        event.target.value,
                                      ),
                                    }))
                                  }
                                  className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                Statement label
                              </label>
                              <input
                                type="text"
                                value={payrollRunForm.periodLabel}
                                onChange={(event) =>
                                  setPayrollRunForm((current) => ({
                                    ...current,
                                    periodLabel: event.target.value,
                                  }))
                                }
                                className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                              />
                            </div>
                            <div className="rounded-lg border border-blue/20 bg-blue/10 px-4 py-3 text-sm text-blue">
                              Custom runs process finalized attendance only
                              within the selected dates. Use this when you need
                              back pay or a catch-up payroll instead of only the
                              latest closed week or month. Pending shifts inside
                              that range will block processing until they are
                              resolved or verified.
                            </div>
                          </div>
                        ) : isLoadingPayrollRunStatus ? (
                          <div className="mb-6 rounded-lg border border-stroke px-4 py-5 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
                            Loading payroll term status...
                          </div>
                        ) : selectedPayrollRunStatus ? (
                          <div className="mb-6 space-y-3 text-left">
                            <div className="rounded-lg border border-stroke px-4 py-4 dark:border-dark-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                Current Term
                              </p>
                              <p className="mt-2 font-semibold text-dark dark:text-white">
                                {selectedPayrollRunStatus.periodLabel}
                              </p>
                              <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                                {formatPayrollDateLabel(
                                  selectedPayrollRunStatus.periodStart,
                                )}{" "}
                                to{" "}
                                {formatPayrollDateLabel(
                                  selectedPayrollRunStatus.periodEnd,
                                )}
                              </p>
                              <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                                Next term opens on{" "}
                                {formatPayrollDateLabel(
                                  selectedPayrollRunStatus.nextAvailableOn,
                                )}
                                .
                              </p>
                            </div>
                            <div
                              className={`rounded-lg border px-4 py-3 text-sm ${
                                selectedPayrollRunStatus.isLocked ||
                                selectedPayrollRunStatus.warningMessage
                                  ? "border-amber/20 bg-amber/10 text-amber"
                                  : "border-blue/20 bg-blue/10 text-blue"
                              }`}
                            >
                              {selectedPayrollRunStatus.isLocked
                                ? selectedPayrollRunStatus.lockReason
                                : (selectedPayrollRunStatus.warningMessage ??
                                  `This ${payrollFrequency} payroll term is ready to run.`)}
                            </div>
                          </div>
                        ) : (
                          <div className="mb-6 rounded-lg border border-red/20 bg-red/10 px-4 py-4 text-sm text-red">
                            Payroll term status is unavailable right now.
                          </div>
                        )}
                        <div className="mb-6 space-y-4 text-left">
                          <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Payment method
                            </label>
                            <select
                              value={payrollRunForm.paymentMethod}
                              onChange={(event) =>
                                setPayrollRunForm((current) => ({
                                  ...current,
                                  paymentMethod: event.target
                                    .value as PayrollRunFormState["paymentMethod"],
                                }))
                              }
                              className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                            >
                              {PAYROLL_PAYMENT_METHOD_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {selectedPayrollMember && canAddPayrollAdjustments ? (
                            <div className="space-y-4 rounded-lg border border-stroke px-4 py-4 dark:border-dark-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                  Payroll adjustments
                                </p>
                                <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                                  Bonus and deduction values apply only to this
                                  employee&apos;s generated statement.
                                </p>
                              </div>
                              <div>
                                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                  Bonus
                                </label>
                                <CurrencyInput
                                  value={payrollRunForm.bonusAmount}
                                  onValueChange={(decimalValue) =>
                                    setPayrollRunForm((current) => ({
                                      ...current,
                                      bonusAmount: decimalValue,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                {[
                                  { key: "incomeTax", label: "Income Tax" },
                                  {
                                    key: "socialSecurity",
                                    label: "Social Security",
                                  },
                                  {
                                    key: "healthInsurance",
                                    label: "Health Insurance",
                                  },
                                  {
                                    key: "employeeAdvance",
                                    label: "Employee Advance",
                                  },
                                  { key: "other", label: "Other" },
                                ].map((field) => (
                                  <div key={field.key}>
                                    <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                      {field.label}
                                    </label>
                                    <CurrencyInput
                                      value={
                                        payrollRunForm.deductions[
                                          field.key as keyof DeductionFormState
                                        ]
                                      }
                                      onValueChange={(decimalValue) =>
                                        setPayrollRunForm((current) => ({
                                          ...current,
                                          deductions: {
                                            ...current.deductions,
                                            [field.key]: decimalValue,
                                          },
                                        }))
                                      }
                                      className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                                    />
                                  </div>
                                ))}
                              </div>
                              <div className="rounded-lg border border-blue/20 bg-blue/10 px-4 py-3 text-sm text-blue">
                                Total deductions:{" "}
                                {formatPayrollCurrency(
                                  payrollRunDeductions.total,
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="mb-6 space-y-4 text-left">
                        <div className="rounded-lg border border-stroke px-4 py-4 dark:border-dark-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Employee
                          </p>
                          <p className="mt-2 font-semibold text-dark dark:text-white">
                            {selectedPayrollMember?.name}
                          </p>
                          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                            Hourly rate:{" "}
                            {formatPayrollCurrency(
                              selectedPayrollMember?.hourlyRate ?? 0,
                            )}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Period start
                            </label>
                            <input
                              type="date"
                              value={offCyclePayrollForm.periodStartDate}
                              onChange={(event) =>
                                setOffCyclePayrollForm((current) => ({
                                  ...current,
                                  periodStartDate: event.target.value,
                                  periodLabel: buildOffCyclePeriodLabel(
                                    event.target.value,
                                    current.periodEndDate,
                                  ),
                                }))
                              }
                              className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Period end
                            </label>
                            <input
                              type="date"
                              value={offCyclePayrollForm.periodEndDate}
                              onChange={(event) =>
                                setOffCyclePayrollForm((current) => ({
                                  ...current,
                                  periodEndDate: event.target.value,
                                  periodLabel: buildOffCyclePeriodLabel(
                                    current.periodStartDate,
                                    event.target.value,
                                  ),
                                }))
                              }
                              className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Pay date
                            </label>
                            <input
                              type="date"
                              value={offCyclePayrollForm.payDate}
                              onChange={(event) =>
                                setOffCyclePayrollForm((current) => ({
                                  ...current,
                                  payDate: event.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              Statement status
                            </label>
                            <select
                              value={offCyclePayrollForm.status}
                              onChange={(event) =>
                                setOffCyclePayrollForm((current) => ({
                                  ...current,
                                  status: event.target
                                    .value as OffCyclePayrollStatus,
                                }))
                              }
                              className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                            >
                              <option value="draft">Draft</option>
                              <option value="processed">Scheduled</option>
                              <option value="paid">Paid</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Payment method
                          </label>
                          <select
                            value={offCyclePayrollForm.paymentMethod}
                            onChange={(event) =>
                              setOffCyclePayrollForm((current) => ({
                                ...current,
                                paymentMethod: event.target
                                  .value as OffCyclePayrollFormState["paymentMethod"],
                              }))
                            }
                            className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                          >
                            {PAYROLL_PAYMENT_METHOD_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {selectedPayrollMember && canAddPayrollAdjustments ? (
                          <div className="space-y-4 rounded-lg border border-stroke px-4 py-4 dark:border-dark-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                Payroll adjustments
                              </p>
                              <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                                Bonus and deduction values will be saved with
                                this off-cycle paystub.
                              </p>
                            </div>
                            <div>
                              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                Bonus
                              </label>
                              <CurrencyInput
                                value={offCyclePayrollForm.bonusAmount}
                                onValueChange={(decimalValue) =>
                                  setOffCyclePayrollForm((current) => ({
                                    ...current,
                                    bonusAmount: decimalValue,
                                  }))
                                }
                                className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { key: "incomeTax", label: "Income Tax" },
                                {
                                  key: "socialSecurity",
                                  label: "Social Security",
                                },
                                {
                                  key: "healthInsurance",
                                  label: "Health Insurance",
                                },
                                {
                                  key: "employeeAdvance",
                                  label: "Employee Advance",
                                },
                                { key: "other", label: "Other" },
                              ].map((field) => (
                                <div key={field.key}>
                                  <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                                    {field.label}
                                  </label>
                                  <CurrencyInput
                                    value={
                                      offCyclePayrollForm.deductions[
                                        field.key as keyof DeductionFormState
                                      ]
                                    }
                                    onValueChange={(decimalValue) =>
                                      setOffCyclePayrollForm((current) => ({
                                        ...current,
                                        deductions: {
                                          ...current.deductions,
                                          [field.key]: decimalValue,
                                        },
                                      }))
                                    }
                                    className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="rounded-lg border border-blue/20 bg-blue/10 px-4 py-3 text-sm text-blue">
                              Total deductions:{" "}
                              {formatPayrollCurrency(
                                offCyclePayrollDeductions.total,
                              )}
                            </div>
                          </div>
                        ) : null}
                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Statement label
                          </label>
                          <input
                            type="text"
                            value={offCyclePayrollForm.periodLabel}
                            onChange={(event) =>
                              setOffCyclePayrollForm((current) => ({
                                ...current,
                                periodLabel: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Notes
                          </label>
                          <textarea
                            rows={3}
                            value={offCyclePayrollForm.notes}
                            onChange={(event) =>
                              setOffCyclePayrollForm((current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                            placeholder="Optional note for this special pay period."
                          />
                        </div>
                        <div className="rounded-lg border border-blue/20 bg-blue/10 px-4 py-3 text-sm text-blue">
                          Off-cycle payroll uses finalized attendance within the
                          selected date range only. If no cleared attendance
                          records exist for that period, the paystub will not be
                          created. Pending shifts in that range must be resolved
                          first.
                        </div>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={handleClosePayrollModal}
                        className="flex-1 rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark hover:bg-gray-1 dark:border-dark-3 dark:text-white"
                      >
                        Cancel
                      </button>
                      {payrollMode === "run" ? (
                        <button
                          onClick={() => void handleRunPayroll()}
                          disabled={
                            payrollRunForm.useCustomRange
                              ? !payrollRunForm.periodStartDate ||
                                !payrollRunForm.periodEndDate
                              : isLoadingPayrollRunStatus ||
                                !selectedPayrollRunStatus ||
                                selectedPayrollRunStatus.isLocked ||
                                Boolean(selectedPayrollRunStatus.warningMessage)
                          }
                          className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Process{" "}
                          {payrollFrequency === "weekly" ? "Weekly" : "Monthly"}{" "}
                          Run
                        </button>
                      ) : (
                        <button
                          onClick={() => void handleCreateOffCyclePayroll()}
                          className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Create Off-Cycle Paystub
                        </button>
                      )}
                    </div>
                  </>
                )}

                {payrollStatus === "processing" && (
                  <div className="py-8">
                    <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    <p className="mt-4 font-medium text-dark dark:text-white">
                      {payrollMode === "offcycle" && selectedPayrollMember
                        ? `Creating off-cycle payroll for ${selectedPayrollMember.name}...`
                        : payrollRunForm.useCustomRange && selectedPayrollMember
                          ? `Running custom payroll for ${selectedPayrollMember.name}...`
                          : payrollRunForm.useCustomRange
                            ? "Running custom payroll..."
                            : selectedPayrollMember
                              ? `Running ${payrollFrequency} payroll for ${selectedPayrollMember.name}...`
                              : `Running ${payrollFrequency} payroll...`}
                    </p>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      Please do not close this window
                    </p>
                  </div>
                )}

                {payrollStatus === "completed" && (
                  <>
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green/10">
                      <CheckCircle className="h-8 w-8 text-green" />
                    </div>
                    <h3 className="mb-2 text-lg font-bold text-dark dark:text-white">
                      Payroll Complete
                    </h3>
                    <p className="mb-4 text-sm text-dark-5 dark:text-dark-6">
                      {payrollMode === "offcycle" && offCyclePayrollSummary
                        ? `${offCyclePayrollSummary.period} was created for ${offCyclePayrollSummary.employeeName}.`
                        : payrollRunSummary
                          ? `${payrollRunSummary.periodLabel} created ${payrollRunSummary.employeeCount} payroll statement${payrollRunSummary.employeeCount === 1 ? "" : "s"}.`
                          : "Payroll has been successfully processed."}
                    </p>
                    {payrollMode === "offcycle" && offCyclePayrollSummary ? (
                      <div className="mb-6 space-y-3 text-left">
                        <div className="rounded-lg border border-stroke px-4 py-4 dark:border-dark-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Off-Cycle Statement
                          </p>
                          <p className="mt-2 font-semibold text-dark dark:text-white">
                            {offCyclePayrollSummary.period}
                          </p>
                          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                            Pay date:{" "}
                            {formatPayrollDateLabel(
                              offCyclePayrollSummary.payDate,
                            )}
                          </p>
                          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                            Gross:{" "}
                            {formatPayrollCurrency(
                              offCyclePayrollSummary.grossPayTotal,
                            )}
                          </p>
                          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                            Net:{" "}
                            {formatPayrollCurrency(
                              offCyclePayrollSummary.netPay,
                            )}
                          </p>
                          <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                            Status:{" "}
                            {formatOffCycleStatusLabel(
                              offCyclePayrollSummary.status,
                            )}
                          </p>
                        </div>
                      </div>
                    ) : payrollRunSummary ? (
                      <div className="mb-6 space-y-3 text-left">
                        <div className="rounded-lg border border-stroke px-4 py-4 dark:border-dark-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            {payrollRunSummary.isCustomRange
                              ? "Processed Range"
                              : "Processed Term"}
                          </p>
                          <p className="mt-2 font-semibold text-dark dark:text-white">
                            {payrollRunSummary.periodLabel}
                          </p>
                          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                            {formatPayrollDateLabel(
                              payrollRunSummary.periodStart,
                            )}{" "}
                            to{" "}
                            {formatPayrollDateLabel(
                              payrollRunSummary.periodEnd,
                            )}
                          </p>
                          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                            Gross:{" "}
                            {formatPayrollCurrency(
                              payrollRunSummary.totalGrossPay,
                            )}
                          </p>
                          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                            Net:{" "}
                            {formatPayrollCurrency(
                              payrollRunSummary.totalNetPay,
                            )}
                          </p>
                          {payrollRunSummary.isCustomRange ? (
                            <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                              Custom range payroll uses finalized attendance
                              only inside the selected window.
                            </p>
                          ) : (
                            <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                              Next term opens on{" "}
                              {formatPayrollDateLabel(
                                payrollRunSummary.nextAvailableOn,
                              )}
                              .
                            </p>
                          )}
                        </div>
                      </div>
                    ) : null}
                    <button
                      onClick={handleClosePayrollModal}
                      className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                    >
                      Done
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {showRoleManager && (
        <ModalPortal>
          <div className="modal-shell z-50 bg-black/50">
            <div className="modal-card max-w-4xl rounded-lg bg-white dark:bg-dark-2">
              <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-dark dark:text-white">
                    Role & Permissions Matrix
                  </h2>
                  <button
                    onClick={() => setShowRoleManager(false)}
                    className="text-dark-5 transition hover:text-dark dark:text-dark-6 dark:hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto p-6">
                <div className="grid gap-4">
                  {(
                    Object.entries(ROLE_PERMISSIONS) as Array<
                      [StaffRole, (typeof ROLE_PERMISSIONS)[StaffRole]]
                    >
                  ).map(([role, config]) => (
                    <div
                      key={role}
                      className="rounded-lg border border-stroke p-4 dark:border-dark-3"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-dark dark:text-white">
                            {config.label}
                          </h3>
                          <p className="text-sm text-dark-5 dark:text-dark-6">
                            {config.description}
                          </p>
                        </div>
                        <div
                          className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                          style={{ backgroundColor: config.color }}
                        >
                          {config.permissions.length} permissions
                        </div>
                      </div>

                      <div className="grid gap-2 md:grid-cols-2">
                        {config.permissions.map((permission) => (
                          <div
                            key={permission}
                            className="flex items-center gap-2 rounded-lg bg-gray-1 p-2 dark:bg-dark-3"
                          >
                            <CheckCircle className="h-4 w-4 text-green" />
                            <span className="text-xs capitalize text-dark-5 dark:text-dark-6">
                              {formatPermission(permission)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-stroke px-6 py-4 dark:border-dark-3">
                <button
                  onClick={() => setShowRoleManager(false)}
                  className="rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark transition-colors hover:bg-gray-1 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
                >
                  Close Matrix
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {showModal && (
        <ModalPortal>
          <div className="modal-shell z-50 bg-black/50">
            <div className="modal-card max-w-4xl rounded-lg bg-white dark:bg-dark-2">
              <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
                <h2 className="text-xl font-bold text-dark dark:text-white">
                  {editingMember ? "Edit Staff Member" : "Add Staff Member"}
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
                <div className="space-y-4 border-stroke p-6 dark:border-dark-3 md:border-r">
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                    Basic Information
                  </h3>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(event) =>
                          setFormData((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={formData.phone}
                        onChange={(event) =>
                          setFormData((current) => ({
                            ...current,
                            phone: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(event) =>
                          setFormData((current) => ({
                            ...current,
                            email: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Employee Number
                      </label>
                      <input
                        type="text"
                        value={formData.employeeNumber}
                        onChange={(event) =>
                          setFormData((current) => ({
                            ...current,
                            employeeNumber: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                        placeholder="EMP-1024"
                      />
                    </div>
                  </div>

                  {!editingMember && isAdmin ? (
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Password
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={formData.password}
                        onChange={(event) =>
                          setFormData((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                        placeholder="Leave blank to auto-generate"
                      />
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Role *
                      </label>
                      <select
                        value={formData.role}
                        onChange={(event) =>
                          handleRoleChange(event.target.value as StaffRole)
                        }
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      >
                        {(
                          Object.entries(ROLE_PERMISSIONS) as Array<
                            [StaffRole, (typeof ROLE_PERMISSIONS)[StaffRole]]
                          >
                        ).map(([role, config]) => (
                          <option key={role} value={role}>
                            {config.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                        Hourly Rate ($/hr)
                      </label>
                      <CurrencyInput
                        value={formData.hourlyRate}
                        onValueChange={(_, numericValue) =>
                          setFormData((current) => ({
                            ...current,
                            hourlyRate: numericValue,
                          }))
                        }
                        className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Account Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(event) =>
                        setFormData((current) => ({
                          ...current,
                          status: event.target.value as StaffStatus,
                        }))
                      }
                      className="w-full rounded-lg border border-stroke bg-transparent px-4 py-2 text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="on-leave">On Leave</option>
                    </select>
                  </div>

                  {!editingMember && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-dark-5 dark:text-dark-6">
                      Creating this member will also create a real login. The
                      employee will be assigned to{" "}
                      <span className="font-semibold text-dark dark:text-white">
                        {activeStore?.name ?? "the active store"}
                      </span>
                      . A temporary password will be shown after save.
                    </div>
                  )}
                </div>

                <div className="bg-gray-2 p-6 dark:bg-dark-3/30">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                      Custom Permissions
                    </h3>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                      {formData.permissions.length} SELECTED
                    </span>
                  </div>

                  {formData.role === "admin" ? (
                    <div className="rounded-lg border border-dashed border-primary/30 bg-white p-4 text-sm text-dark-5 dark:border-primary/20 dark:bg-dark-2 dark:text-dark-6">
                      Admin accounts always receive full access (`*`).
                    </div>
                  ) : (
                    <div className="max-h-[360px] space-y-4 overflow-y-auto pr-2">
                      {PERMISSION_GROUPS.map((group) => (
                        <div key={group.label}>
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-dark-5 dark:text-dark-6">
                            {group.label}
                          </p>
                          <div className="grid grid-cols-1 gap-2">
                            {group.permissions.map((permission) => (
                              <button
                                key={permission}
                                onClick={() => togglePermission(permission)}
                                className={`flex items-center justify-between rounded-lg border p-3 transition-all ${
                                  formData.permissions.includes(permission)
                                    ? "border-primary bg-primary/5 text-primary"
                                    : "border-stroke bg-white text-dark-5 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6"
                                }`}
                              >
                                <span className="text-xs font-semibold capitalize">
                                  {formatPermission(permission)}
                                </span>
                                {formData.permissions.includes(permission) ? (
                                  <Check className="h-3 w-3" />
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="mt-4 text-[10px] italic leading-relaxed text-dark-5 dark:text-dark-6">
                    Changing the role resets permissions to the role default.
                    You can then customize them here.
                  </p>
                </div>
              </div>

              <div className="border-t border-stroke px-6 py-4 dark:border-dark-3">
                <div className="flex gap-3">
                  <button
                    onClick={handleCloseModal}
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark hover:bg-gray-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleSaveMember()}
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting
                      ? editingMember
                        ? "Saving..."
                        : "Creating..."
                      : editingMember
                        ? "Save Changes"
                        : "Create Member"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
