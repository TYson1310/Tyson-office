"use client";

import React from "react";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon?: React.ReactNode;
  color?: "primary" | "green" | "red" | "blue" | "orange";
}

export function StatCard({ title, value, change, icon, color = "primary" }: StatCardProps) {
  const colorClasses = {
    primary: "bg-primary",
    green: "bg-green",
    red: "bg-red",
    blue: "bg-blue",
    orange: "bg-orange-light",
  };

  const changeColor = change && change > 0 ? "text-green" : "text-red";

  return (
    <div className="rounded-md border border-stroke bg-white p-6 dark:border-stroke-dark dark:bg-dark-2">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-body-sm font-medium text-body-color">{title}</h4>
        {icon && (
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${colorClasses[color]} text-white`}>
            {icon}
          </div>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-heading-5 font-bold text-dark dark:text-white">{value}</p>
          {change !== undefined && (
            <p className={`text-body-xs font-medium ${changeColor} mt-1`}>
              {change > 0 ? "+" : ""}{change}% vs last month
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
