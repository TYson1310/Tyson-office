import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access Denied",
};

export default function UnauthorizedPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
        Access denied
      </p>
      <h1 className="mt-3 text-3xl font-bold text-dark dark:text-white">
        No page is available for this account.
      </h1>
      <p className="mt-4 text-base text-dark-5 dark:text-dark-6">
        Ask an administrator to review the account permissions for this store.
      </p>
    </main>
  );
}
