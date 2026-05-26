"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);

  return (
    <html lang="en">
      <body className="bg-gray-2 dark:bg-[#020d1a]">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-xl rounded-[28px] border border-stroke bg-white p-8 text-center shadow-1 dark:border-dark-3 dark:bg-gray-dark">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              System Error
            </p>
            <h1 className="mt-3 text-3xl font-bold text-dark dark:text-white">
              The application could not recover
            </h1>
            <p className="mt-3 text-sm text-dark-5 dark:text-dark-6">
              Reload the page or try again in a moment.
            </p>
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
