"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

type SalesChartCardProps = {
  series: {
    daily: { label: string; value: number }[];
    monthly: { label: string; value: number }[];
    yearly: { label: string; value: number }[];
  };
};

const tabs = [
  { id: "daily", label: "Daily" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
] as const;

export function SalesChartCard({ series }: SalesChartCardProps) {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("daily");
  const data = series[activeTab];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            Sales Trend
          </h3>
          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
            Switch between daily, monthly, and yearly logged sales.
          </p>
        </div>

        <div className="inline-flex rounded-full border border-stroke bg-gray-2/70 p-1 dark:border-dark-3 dark:bg-dark-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                activeTab === tab.id
                  ? "bg-primary text-white shadow-sm"
                  : "text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full min-w-0">
        <ResponsiveContainer
          width="100%"
          height={320}
          minWidth={0}
          initialDimension={{ width: 768, height: 320 }}
        >
          <BarChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(148, 163, 184, 0.18)"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#94A3B8", fontSize: 12 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#94A3B8", fontSize: 12 }}
              tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
            />
            <Tooltip
              cursor={{ fill: "rgba(15, 118, 110, 0.08)" }}
              formatter={(value) => [
                `$${Number(value ?? 0).toLocaleString()}`,
                "Sales",
              ]}
              contentStyle={{
                borderRadius: 16,
                border: "1px solid rgba(15, 23, 42, 0.08)",
                boxShadow: "0 18px 48px rgba(15, 23, 42, 0.12)",
              }}
            />
            <Bar
              dataKey="value"
              radius={[10, 10, 4, 4]}
              fill="#0F766E"
              maxBarSize={42}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
