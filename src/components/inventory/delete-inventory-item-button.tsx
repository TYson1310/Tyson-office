"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useAppNotifications } from "@/contexts/NotificationContext";

type DeleteInventoryItemButtonProps = {
  productId: string;
  productName: string;
  productSku: string;
};

export function DeleteInventoryItemButton({
  productId,
  productName,
  productSku,
}: DeleteInventoryItemButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    if (
      !window.confirm(
        `Delete SKU ${productSku} (${productName})? The SKU will be removed from active inventory, but existing sales and inventory history will stay on file.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/products?id=${encodeURIComponent(productId)}`,
          { method: "DELETE" },
        );
        const body = (await response.json().catch(() => null)) as
          | { success?: true }
          | { error?: string }
          | null;

        if (!response.ok || (body && "error" in body && body.error)) {
          throw new Error(
            body && "error" in body && body.error
              ? body.error
              : "Failed to delete SKU",
          );
        }

        router.refresh();
      } catch (error) {
        notifyError(
          error instanceof Error ? error.message : "Failed to delete SKU",
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
      disabled={isDeleting}
      className="app-icon-button app-danger-icon-button disabled:cursor-not-allowed disabled:opacity-60"
      title="Delete SKU"
      aria-label={`Delete SKU ${productSku}`}
    >
      {isDeleting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}
