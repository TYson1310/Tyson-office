"use client";

import type { PropsWithChildren } from "react";

export default function AuthLayout({ children }: PropsWithChildren) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(13,148,136,0.14),transparent_38%),linear-gradient(180deg,#fcfffe_0%,#eef8f6_56%,#f8fbff_100%)] p-3 sm:p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-teal-300/25 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 h-96 w-96 rounded-full bg-cyan-200/35 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-100/60 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
