"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-[24px] border border-stroke bg-white p-6 text-center shadow-1 sm:rounded-[28px] sm:p-8 dark:border-dark-3 dark:bg-gray-dark">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
          Application Error
        </p>
        <h1 className="mt-3 text-3xl font-bold text-dark dark:text-white">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm text-dark-5 dark:text-dark-6">
          The request failed unexpectedly. Try again or refresh the page.
        </p>
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}
