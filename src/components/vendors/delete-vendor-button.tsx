"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type DeleteVendorButtonProps = {
  vendorId: string;
  vendorName: string;
  disabled?: boolean;
  disabledMessage?: string;
};

export function DeleteVendorButton({
  vendorId,
  vendorName,
  disabled = false,
  disabledMessage = "Vendor actions are unavailable right now.",
}: DeleteVendorButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    if (
      !window.confirm(
        `Deactivate ${vendorName}? The vendor record will stay on file and can be reactivated later.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/vendors?id=${encodeURIComponent(vendorId)}`,
          {
            method: "DELETE",
          },
        );
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? "Failed to deactivate vendor");
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to deactivate vendor",
        );
      } finally {
        setIsDeleting(false);
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={disabled || isDeleting}
      className="app-icon-button app-danger-icon-button disabled:cursor-not-allowed disabled:opacity-60"
      title={disabled ? disabledMessage : "Deactivate vendor"}
      aria-label="Deactivate vendor"
    >
      {isDeleting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}
