import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-[24px] border border-stroke bg-white p-6 text-center shadow-1 sm:rounded-[28px] sm:p-8 dark:border-dark-3 dark:bg-gray-dark">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
          404
        </p>
        <h1 className="mt-3 text-3xl font-bold text-dark dark:text-white">
          Page not found
        </h1>
        <p className="mt-3 text-sm text-dark-5 dark:text-dark-6">
          The page you requested does not exist or is no longer available.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/"
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
