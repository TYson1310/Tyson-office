"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Lock, Save, Wallet } from "lucide-react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { EodReconciliationWorkbench } from "@/components/lottery/eod-reconciliation-workbench";
import type { LotteryEodReconciliationData } from "@/lib/lottery/eod-reconciliation";
import { useAuth } from "@/contexts/AuthContext";
import { useAppNotifications } from "@/contexts/NotificationContext";
import { useStore } from "@/contexts/StoreContext";
import { getTodayIsoDateInTimeZone } from "@/lib/date-time";

type Props = {
  canSelectDate: boolean;
  data: LotteryEodReconciliationData;
  todayDate: string;
};

type Review = {
  id: string;
  businessDate: string;
  posCashCounted: number;
  nrsCashTotal: number | null;
  variance: number | null;
  status: "counted" | "approved";
  updateCount: number;
};

type NrsImport = {
  business_date: string;
  sales_total: number | string;
  cash_tender_total: number | string | null;
  item_count: number;
};

type AuditEntry = {
  id: string;
  summary: string;
  actor_name: string | null;
  actor_role: string;
  metadata: { updateNumber?: number; changeReason?: string | null; changes?: Record<string, { from: number | null; to: number }> };
  created_at: string;
};

const money = (value: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);

export function DailyCloseoutShell({ canSelectDate, data, todayDate }: Props) {
  const { user } = useAuth();
  const { activeStore } = useStore();
  const { notify } = useAppNotifications();
  const [lotteryDone, setLotteryDone] = useState(data.isReconciled);
  const [review, setReview] = useState<Review | null>(null);
  const [imports, setImports] = useState<NrsImport[]>([]);
  const [cash, setCash] = useState(0);
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [history, setHistory] = useState<AuditEntry[]>([]);

  const businessDate = data.businessDate;
  const today = useMemo(
    () => getTodayIsoDateInTimeZone(activeStore?.timeZone ?? "UTC"),
    [activeStore?.timeZone],
  );

  const loadReview = useCallback(async () => {
    const response = await fetch(`/api/sales/eod?date=${businessDate}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? "Unable to load daily closeout");
    setReview(payload.reviews?.[0] ?? null);
    setImports(payload.imports ?? []);
    setHistory(payload.history ?? []);
    if (payload.reviews?.[0]) setCash(payload.reviews[0].posCashCounted);
  }, [businessDate]);

  useEffect(() => {
    void loadReview().catch((error) => notify({ type: "error", message: error.message }));
  }, [loadReview, notify]);

  const imported = imports.find((item) => item.business_date === businessDate);
  const authorized = user?.role === "admin" || user?.role === "manager";
  const variance = review?.variance ?? null;

  async function saveCashCount() {
    setSaving(true);
    try {
      const response = await fetch("/api/sales/eod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessDate,
          posCashCounted: cash,
          changeReason: review ? changeReason : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Unable to close the day");
      setReview(payload);
      setChangeReason("");
      notify({ type: "success", message: "Day closed. This record is open for next-day NRS review." });
    } catch (error) {
      notify({ type: "error", message: error instanceof Error ? error.message : "Unable to close the day" });
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    if (!review || !verified) return;
    setSaving(true);
    try {
      const response = await fetch("/api/sales/eod", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: review.id, verified: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Unable to finalize closeout");
      setReview(payload);
      notify({ type: "success", message: "Daily closeout finalized." });
    } catch (error) {
      notify({ type: "error", message: error instanceof Error ? error.message : "Unable to finalize closeout" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <p className="text-sm font-bold text-primary">Daily Close Out</p>
        <p className="mt-1 text-sm text-dark-5">Complete Lottery EOD, count register cash, then close the day. Management finishes the review after NRS email import.</p>
      </div>
      <EodReconciliationWorkbench
        canSelectDate={canSelectDate}
        data={data}
        todayDate={todayDate}
        onSaved={() => setLotteryDone(true)}
      />
      <section className={`rounded-[28px] border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2 ${!lotteryDone ? "opacity-60" : ""}`}>
        <h2 className="mb-2 flex items-center gap-2 text-xl font-bold text-dark dark:text-white"><Wallet className="h-5 w-5 text-primary" />2. POS cash count</h2>
        <p className="mb-5 text-sm text-dark-5">{lotteryDone ? "Count the physical cash in the POS register. No sales totals or NRS values are entered here." : "Complete Lottery EOD first to unlock the register count."}</p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-[260px] flex-1 text-sm font-semibold text-dark-5">
            Physical cash counted in register
            <CurrencyInput value={cash} currency="USD" showSymbol={false} disabled={!lotteryDone || review?.status === "approved"} onValueChange={(_, value) => setCash(value)} className="mt-2 w-full rounded-xl border border-stroke bg-transparent px-4 py-3 text-lg font-bold text-dark dark:border-dark-3 dark:text-white" />
          </label>
          {review && review.status !== "approved" && <input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="Reason for update (required)" className="rounded-xl border border-stroke px-4 py-3 text-sm dark:border-dark-3 dark:bg-dark-2 dark:text-white" />}
          <button onClick={saveCashCount} disabled={saving || !lotteryDone || review?.status === "approved" || Boolean(review && !changeReason.trim())} className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{review ? "Update Day Close" : "3. Day Close"}</button>
        </div>
        {review && <p className="mt-4 text-sm font-semibold text-primary">{review.status === "approved" ? "Finalized" : imported ? (variance === null ? "NRS Review Required" : Math.abs(variance) < 0.01 ? "NRS Review Required" : "Variance Review") : "Day Closed - Waiting for NRS"}</p>}
        {review && <p className="mt-1 text-xs text-dark-5">Updated {review.updateCount} time{review.updateCount === 1 ? "" : "s"}</p>}
      </section>
      <section className="rounded-[28px] border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
        <h2 className="mb-2 flex items-center gap-2 text-xl font-bold text-dark dark:text-white"><CheckCircle className="h-5 w-5 text-primary" />4. Next-day review</h2>
        {!imported ? <p className="text-sm text-dark-5">Waiting for the forwarded NRS email.</p> : <p className="text-sm text-dark-5">NRS data received: {money(Number(imported.sales_total))} sales across {imported.item_count} items.</p>}
        {review?.nrsCashTotal !== null && review?.nrsCashTotal !== undefined && <p className="mt-3 text-sm font-semibold text-dark dark:text-white">NRS cash tender: {money(review.nrsCashTotal)}</p>}
        {variance !== null && <div className={`mt-4 rounded-xl p-4 ${Math.abs(variance) < 0.01 ? "bg-green/10 text-green" : "bg-red/10 text-red"}`}><p className="text-sm font-bold">{Math.abs(variance) < 0.01 ? "No variance" : "Variance Review"}</p><p className="text-3xl font-black">{money(variance)}</p></div>}
        {imported && review && review.status !== "approved" && <label className="mt-4 flex gap-3 text-sm text-dark-5"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />I verified the NRS sales and inventory data received by email.</label>}
        <button onClick={finalize} disabled={saving || !authorized || !review || !imported || imported.cash_tender_total === null || !verified || review.status === "approved"} className="mt-5 flex items-center gap-2 rounded-xl bg-dark px-6 py-3 font-bold text-white disabled:opacity-50 dark:bg-white dark:text-dark"><Lock className="h-4 w-4" />{review?.status === "approved" ? "Finalized" : "Final Closeout"}</button>
        {!authorized && <p className="mt-3 text-xs text-dark-5">Admin or manager approval is required.</p>}
        {authorized && history.length > 0 && (
          <div className="mt-6 border-t border-stroke pt-5 dark:border-dark-3">
            <h3 className="text-sm font-bold text-dark dark:text-white">Update history</h3>
            <div className="mt-3 space-y-3">
              {history.map((entry) => (
                <div key={entry.id} className="rounded-xl bg-gray-1 p-3 text-xs dark:bg-dark-3">
                  <p className="font-semibold text-dark dark:text-white">
                    {entry.actor_name ?? entry.actor_role} · {new Date(entry.created_at).toLocaleString()}
                  </p>
                  <p className="mt-1 text-dark-5">{entry.summary}</p>
                  {entry.metadata.changeReason && <p className="mt-1 text-dark-5">Reason: {entry.metadata.changeReason}</p>}
                  {entry.metadata.changes?.posCashCounted && <p className="mt-1 text-dark-5">Register cash: {money(entry.metadata.changes.posCashCounted.from ?? 0)} → {money(entry.metadata.changes.posCashCounted.to)}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
