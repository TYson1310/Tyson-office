type SupabaseServerClient = any;

type AccountingLockRow = {
  accounting_close_through: string | null;
  accounting_close_note: string | null;
};

export type AccountingPeriodLock = {
  closeThrough: string | null;
  note: string | null;
};

function normalizeIsoDate(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const normalized = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function isMissingAccountingColumns(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("accounting_close_through") ||
    message.includes("accounting_close_note")
  );
}

export function isAccountingPeriodClosed(
  lock: AccountingPeriodLock | null | undefined,
  entryDate: string | Date | null | undefined,
) {
  if (!lock?.closeThrough || !entryDate) {
    return false;
  }

  const normalizedEntryDate = normalizeIsoDate(entryDate);

  if (!normalizedEntryDate) {
    return false;
  }

  return normalizedEntryDate <= lock.closeThrough;
}

export function buildAccountingLockMessage(
  lock: AccountingPeriodLock,
  label: string,
) {
  const noteSuffix =
    lock.note && lock.note.trim().length > 0
      ? ` Note: ${lock.note.trim()}`
      : "";

  return `${label} is dated in a closed accounting period through ${formatDateLabel(
    lock.closeThrough ?? "",
  )}. Reopen the period in Admin Settings before changing it.${noteSuffix}`;
}

export async function loadAccountingPeriodLock(
  supabase: SupabaseServerClient,
  storeKey: string,
): Promise<AccountingPeriodLock> {
  const { data, error } = await supabase
    .from("store_settings")
    .select("accounting_close_through,accounting_close_note")
    .eq("store_key", storeKey)
    .maybeSingle();

  if (error) {
    if (isMissingAccountingColumns(error)) {
      return {
        closeThrough: null,
        note: null,
      };
    }

    throw error;
  }

  return {
    closeThrough: data?.accounting_close_through ?? null,
    note: data?.accounting_close_note?.trim() || null,
  };
}

export async function assertAccountingPeriodUnlocked(
  supabase: SupabaseServerClient,
  storeKey: string,
  entryDate: string | Date | null | undefined,
  label: string,
) {
  const lock = await loadAccountingPeriodLock(supabase, storeKey);

  if (!isAccountingPeriodClosed(lock, entryDate)) {
    return null;
  }

  return {
    error: buildAccountingLockMessage(lock, label),
    status: 409 as const,
  };
}
