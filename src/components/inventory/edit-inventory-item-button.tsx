"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ModalPortal } from "@/components/ui/modal-portal";

export type EditableInventoryRecord = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  supplierId: string;
  location: string;
  quantity: number;
  itemsPerPack: number;
  reorderLevel: number;
  dailyVelocity: number;
  cost: number;
  price: number;
  targetMarginPercent: number;
};

type InventorySupplierOption = {
  id: string;
  name: string;
};

type InventoryFormState = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  supplierId: string;
  location: string;
  quantity: string;
  quantityAdjustmentReason: string;
  quantityAdjustmentReference: string;
  itemsPerPack: string;
  reorderLevel: string;
  dailyVelocity: string;
  cost: string;
  price: string;
  targetMarginPercent: string;
};

type EditInventoryItemButtonProps = {
  product: EditableInventoryRecord;
  quantityAdjustmentsAvailable: boolean;
  suppliers: InventorySupplierOption[];
};

const INPUT_CLASSNAME = "app-input";

function getInitialFormState(
  product: EditableInventoryRecord,
): InventoryFormState {
  return {
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    category: product.category,
    supplierId: product.supplierId,
    location: product.location,
    quantity: `${product.quantity}`,
    quantityAdjustmentReason: "",
    quantityAdjustmentReference: "",
    itemsPerPack: `${product.itemsPerPack}`,
    reorderLevel: `${product.reorderLevel}`,
    dailyVelocity: product.dailyVelocity.toFixed(1),
    cost: product.cost.toFixed(2),
    price: product.price.toFixed(2),
    targetMarginPercent: product.targetMarginPercent.toFixed(1),
  };
}

export function EditInventoryItemButton({
  product,
  quantityAdjustmentsAvailable,
  suppliers,
}: EditInventoryItemButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState<InventoryFormState>(
    getInitialFormState(product),
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openModal = () => {
    setFormState(getInitialFormState(product));
    setError("");
    setIsOpen(true);
  };

  const closeModal = () => {
    if (isSubmitting) {
      return;
    }

    setIsOpen(false);
    setFormState(getInitialFormState(product));
    setError("");
  };
  const quantityChanged = Number(formState.quantity) !== product.quantity;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    void (async () => {
      try {
        if (quantityChanged && !quantityAdjustmentsAvailable) {
          throw new Error(
            "Apply the latest financial accountability migration before changing quantity on hand.",
          );
        }

        const response = await fetch("/api/products", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: product.id,
            name: formState.name,
            sku: formState.sku,
            barcode: formState.barcode,
            category: formState.category,
            supplierId: formState.supplierId,
            location: formState.location,
            quantity: formState.quantity,
            quantityAdjustmentReason: formState.quantityAdjustmentReason,
            quantityAdjustmentReference: formState.quantityAdjustmentReference,
            itemsPerPack: formState.itemsPerPack,
            reorderLevel: formState.reorderLevel,
            dailyVelocity: formState.dailyVelocity,
            cost: formState.cost,
            price: formState.price,
            targetMarginPercent: formState.targetMarginPercent,
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | { id: string; name: string }
          | { error?: string }
          | null;

        if (!response.ok || (body && "error" in body && body.error)) {
          throw new Error(
            body && "error" in body && body.error
              ? body.error
              : "Failed to update inventory item",
          );
        }

        setIsOpen(false);
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to update inventory item",
        );
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="app-icon-button app-icon-button-accent"
        aria-label={`Edit ${product.name}`}
        title={`Edit ${product.name}`}
      >
        <Pencil className="h-4 w-4" />
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-3xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    Edit inventory item
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    Update stock, replenishment thresholds, and pricing for this
                    SKU.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="app-icon-button"
                  aria-label="Close edit inventory item dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-6">
                {error ? (
                  <div className="mb-4 rounded-[20px] border border-red/15 bg-red/5 px-4 py-3 text-sm text-red">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Product name
                    </label>
                    <input
                      required
                      value={formState.name}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Blueberry Muffin"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      SKU
                    </label>
                    <input
                      required
                      value={formState.sku}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          sku: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="SKU-1001"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      UPC / Barcode
                    </label>
                    <input
                      value={formState.barcode}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          barcode: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="012345678905"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Category
                    </label>
                    <input
                      required
                      value={formState.category}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Bakery"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Supplier
                    </label>
                    <select
                      value={formState.supplierId}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          supplierId: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                    >
                      <option value="">Unassigned supplier</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Location
                    </label>
                    <input
                      value={formState.location}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          location: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Aisle 2"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Quantity on hand
                    </label>
                    <input
                      required
                      type="number"
                      step="1"
                      value={formState.quantity}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0"
                      disabled={!quantityAdjustmentsAvailable || isSubmitting}
                    />
                    {!quantityAdjustmentsAvailable ? (
                      <p className="mt-2 text-xs text-amber-700">
                        Migration required for stock quantity changes.
                      </p>
                    ) : null}
                  </div>

                  {quantityChanged ? (
                    <>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                          Quantity change reason
                        </label>
                        <input
                          required
                          value={formState.quantityAdjustmentReason}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              quantityAdjustmentReason: event.target.value,
                            }))
                          }
                          className={INPUT_CLASSNAME}
                          placeholder="Count correction, shrink, found stock..."
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                          Reference
                        </label>
                        <input
                          value={formState.quantityAdjustmentReference}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              quantityAdjustmentReference: event.target.value,
                            }))
                          }
                          className={INPUT_CLASSNAME}
                          placeholder="Count sheet or approval ref"
                        />
                      </div>
                    </>
                  ) : null}

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Items in pack
                    </label>
                    <input
                      required
                      type="number"
                      min="1"
                      step="1"
                      value={formState.itemsPerPack}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          itemsPerPack: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="1"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Reorder level
                    </label>
                    <input
                      required
                      type="number"
                      min="0"
                      step="1"
                      value={formState.reorderLevel}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          reorderLevel: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Daily velocity
                    </label>
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.1"
                      value={formState.dailyVelocity}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          dailyVelocity: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0.0"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Cost
                    </label>
                    <CurrencyInput
                      required
                      value={formState.cost}
                      onValueChange={(decimalValue) =>
                        setFormState((current) => ({
                          ...current,
                          cost: decimalValue,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Sell price
                    </label>
                    <CurrencyInput
                      required
                      value={formState.price}
                      onValueChange={(decimalValue) =>
                        setFormState((current) => ({
                          ...current,
                          price: decimalValue,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Target margin %
                    </label>
                    <input
                      required
                      type="number"
                      min="0"
                      max="95"
                      step="0.1"
                      value={formState.targetMarginPercent}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          targetMarginPercent: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="0.0"
                    />
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="app-secondary-button-sm"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving
                      </>
                    ) : (
                      "Save changes"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
