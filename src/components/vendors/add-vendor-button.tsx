"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import type { PaymentTerms } from "@/types/erp.types";
import { VendorFormMessage } from "@/components/vendors/vendor-form-message";
import { VendorModal } from "@/components/vendors/vendor-modal";

type VendorStatus = "active" | "inactive" | "blacklisted";

export type EditableVendorRecord = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  category: string;
  city: string;
  paymentTerms: PaymentTerms;
  status: VendorStatus;
};

type VendorFormState = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  category: string;
  city: string;
  paymentTerms: PaymentTerms;
  status: VendorStatus;
};

type AddVendorButtonProps = {
  disabled?: boolean;
  disabledMessage?: string;
  vendor?: EditableVendorRecord;
  buttonLabel?: string;
  tone?: "primary" | "secondary";
  iconOnly?: boolean;
};

const INPUT_CLASSNAME = "app-input";

const INITIAL_FORM_STATE: VendorFormState = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  category: "",
  city: "",
  paymentTerms: "net30",
  status: "active",
};

function getInitialFormState(vendor?: EditableVendorRecord): VendorFormState {
  if (!vendor) {
    return INITIAL_FORM_STATE;
  }

  return {
    name: vendor.name,
    contactName: vendor.contactName,
    email: vendor.email,
    phone: vendor.phone,
    category: vendor.category,
    city: vendor.city,
    paymentTerms: vendor.paymentTerms,
    status: vendor.status,
  };
}

function getButtonClassName(tone: AddVendorButtonProps["tone"]) {
  if (tone === "secondary") {
    return "app-secondary-button-sm disabled:cursor-not-allowed disabled:opacity-60";
  }

  return "inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300";
}

export function AddVendorButton({
  disabled = false,
  disabledMessage = "Supabase must be configured to manage vendors.",
  vendor,
  buttonLabel,
  tone = "primary",
  iconOnly = false,
}: AddVendorButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState<VendorFormState>(
    getInitialFormState(vendor),
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = Boolean(vendor);

  const openModal = () => {
    setFormState(getInitialFormState(vendor));
    setError("");
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    setFormState(getInitialFormState(vendor));
    setError("");
    setIsSubmitting(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    void (async () => {
      try {
        const response = await fetch("/api/vendors", {
          method: isEditing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            isEditing ? { id: vendor?.id, ...formState } : formState,
          ),
        });
        const body = (await response.json()) as
          | { id: string; name: string }
          | { error?: string };

        if (!response.ok || ("error" in body && body.error)) {
          throw new Error(
            "error" in body && body.error
              ? body.error
              : isEditing
                ? "Failed to update vendor"
                : "Failed to add vendor",
          );
        }

        closeModal();
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : isEditing
              ? "Failed to update vendor"
              : "Failed to add vendor",
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
        disabled={disabled}
        className={
          iconOnly
            ? "app-icon-button app-icon-button-accent disabled:cursor-not-allowed disabled:opacity-60"
            : getButtonClassName(tone)
        }
        title={
          disabled
            ? disabledMessage
            : isEditing
              ? "Edit vendor"
              : "Add vendor"
        }
        aria-label={isEditing ? "Edit vendor" : "Add vendor"}
      >
        {isEditing ? (
          <Pencil className="h-4 w-4" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {iconOnly ? null : (buttonLabel ?? (isEditing ? "Edit" : "Add vendor"))}
      </button>

      {isOpen ? (
        <VendorModal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-2xl rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    {isEditing ? "Edit vendor" : "Add vendor"}
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {isEditing
                      ? "Update supplier contact details, terms, and status."
                      : "Create a supplier record for the vendor directory."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="app-icon-button"
                  aria-label={
                    isEditing
                      ? "Close edit vendor dialog"
                      : "Close add vendor dialog"
                  }
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-6">
                {error ? (
                  <VendorFormMessage
                    tone="error"
                    title={
                      isEditing
                        ? "Unable to save vendor changes"
                        : "Unable to save vendor"
                    }
                    className="mb-4"
                  >
                    {error}
                  </VendorFormMessage>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Vendor name
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
                      placeholder="Premium Supplies Co."
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Contact name
                    </label>
                    <input
                      value={formState.contactName}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          contactName: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="John Smith"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Payment terms
                    </label>
                    <select
                      value={formState.paymentTerms}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          paymentTerms: event.target
                            .value as VendorFormState["paymentTerms"],
                        }))
                      }
                      className={INPUT_CLASSNAME}
                    >
                      <option value="net30">NET30</option>
                      <option value="net60">NET60</option>
                      <option value="net90">NET90</option>
                      <option value="cod">COD</option>
                      <option value="prepaid">PREPAID</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formState.email}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="vendor@example.com"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Phone
                    </label>
                    <input
                      value={formState.phone}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="+1 (555) 123-4567"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Category
                    </label>
                    <input
                      value={formState.category}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="Staples"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      City
                    </label>
                    <input
                      value={formState.city}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          city: event.target.value,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                      placeholder="New York"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-dark dark:text-white">
                      Status
                    </label>
                    <select
                      value={formState.status}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          status: event.target.value as VendorStatus,
                        }))
                      }
                      className={INPUT_CLASSNAME}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="blacklisted">Blacklisted</option>
                    </select>
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-full border border-stroke px-4 py-2 text-sm font-medium text-dark transition hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {isSubmitting
                      ? isEditing
                        ? "Saving..."
                        : "Adding..."
                      : isEditing
                        ? "Save changes"
                        : "Save vendor"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </VendorModal>
      ) : null}
    </>
  );
}
