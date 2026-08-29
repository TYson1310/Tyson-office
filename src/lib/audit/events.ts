import { unstable_noStore as noStore } from "next/cache";
import { getServerStoreContext } from "@/lib/stores/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/erp.types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type AuditEventRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type AuditEventRecord = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  actorId?: string;
  actorName?: string;
  actorRole: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

type AppendAuditEventInput = {
  supabase: SupabaseServerClient;
  storeKey: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  actorId: string;
  actorName?: string | null;
  actorRole: UserRole | string;
  metadata?: Record<string, unknown>;
};

function isMissingAuditEventsRelation(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("audit_events") &&
    (message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("schema cache"))
  );
}

export async function appendAuditEvent({
  supabase,
  storeKey,
  entityType,
  entityId,
  action,
  summary,
  actorId,
  actorName,
  actorRole,
  metadata = {},
}: AppendAuditEventInput) {
  const auditClient = isSupabaseAdminConfigured()
    ? createAdminClient()
    : supabase;
  const { error } = await auditClient.from("audit_events").insert({
    store_key: storeKey,
    entity_type: entityType,
    entity_id: entityId,
    action,
    summary,
    actor_id: actorId,
    actor_name: actorName ?? null,
    actor_role: actorRole,
    metadata,
  });

  if (!error) {
    return { success: true as const, compatibilityMode: false };
  }

  if (isMissingAuditEventsRelation(error)) {
    console.warn(
      "Audit event ledger is unavailable until the latest audit migration is applied.",
    );
    return { success: false as const, compatibilityMode: true };
  }

  console.error("Failed to append audit event:", error.message ?? error);
  return { success: false as const, compatibilityMode: false };
}

export async function listAuditEventsForActiveStore(limit = 100) {
  noStore();

  if (!isSupabaseConfigured()) {
    return {
      events: [] as AuditEventRecord[],
      compatibilityMode: false,
      warning: null as string | null,
    };
  }

  const storeContext = await getServerStoreContext();

  if (!storeContext.activeStoreKey) {
    return {
      events: [] as AuditEventRecord[],
      compatibilityMode: false,
      warning: null as string | null,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select(
      "id,entity_type,entity_id,action,summary,actor_id,actor_name,actor_role,metadata,created_at",
    )
    .eq("store_key", storeContext.activeStoreKey)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AuditEventRow[]>();

  if (error) {
    if (isMissingAuditEventsRelation(error)) {
      return {
        events: [] as AuditEventRecord[],
        compatibilityMode: true,
        warning:
          "The audit ledger migration has not been applied yet. Financial audit events will appear after the latest Supabase migrations are installed.",
      };
    }

    console.error("Failed to load audit events:", error.message ?? error);
    return {
      events: [] as AuditEventRecord[],
      compatibilityMode: false,
      warning: "Failed to load audit events.",
    };
  }

  return {
    events: (data ?? []).map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      summary: row.summary,
      actorId: row.actor_id ?? undefined,
      actorName: row.actor_name ?? undefined,
      actorRole: row.actor_role,
      metadata:
        row.metadata && typeof row.metadata === "object" ? row.metadata : {},
      createdAt: new Date(row.created_at),
    })),
    compatibilityMode: false,
    warning: null as string | null,
  };
}
