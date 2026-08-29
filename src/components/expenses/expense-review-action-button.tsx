"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, Loader2, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { useAppNotifications } from "@/contexts/NotificationContext";

type ExpenseReviewAction = "approved" | "void";

type ExpenseReviewActionButtonProps = {
  expenseId: string;
  expenseName: string;
  action: ExpenseReviewAction;
  disabled?: boolean;
};

const INPUT_CLASSNAME = "app-input";
const MAX_REVIEW_COMMENT_LENGTH = 1000;

const ACTION_COPY: Record<
  ExpenseReviewAction,
  {
    title: string;
    submitLabel: string;
    noteLabel: string;
    description: string;
    placeholder: string;
    buttonClassName: string;
  }
> = {
  approved: {
    title: "Approve expense",
    submitLabel: "Approve",
    noteLabel: "Approval note",
    description:
      "Add an optional approval note. This posts the expense into net profit immediately.",
    placeholder: "Reviewed against the bill copy and store activity.",
    buttonClassName:
      "app-icon-button app-success-icon-button disabled:cursor-not-allowed disabled:opacity-60",
  },
  void: {
    title: "Void expense",
    submitLabel: "Void expense",
    noteLabel: "Void note",
    description:
      "Add an optional void note. The record stays in the audit trail and stops affecting active finance totals.",
    placeholder:
      "Duplicate charge, corrected replacement, or entered in error.",
    buttonClassName:
      "app-icon-button app-danger-icon-button disabled:cursor-not-allowed disabled:opacity-60",
  },
};

export function ExpenseReviewActionButton({
  expenseId,
  expenseName,
  action,
  disabled = false,
}: ExpenseReviewActionButtonProps) {
  const router = useRouter();
  const { error: notifyError } = useAppNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const copy = ACTION_COPY[action];
  const Icon = action === "approved" ? CheckCircle2 : Archive;

  const closeModal = (force = false) => {
    if (isSubmitting && !force) {
      return;
    }

    setIsOpen(false);
    setReviewComment("");
    setError("");
  };

  const openModal = () => {
    setReviewComment("");
    setError("");
    setIsOpen(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    void (async () => {
      try {
        const response = await fetch("/api/expenses", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: expenseId,
            status: action,
            reviewComment,
          }),
        });
        const body = (await response.json()) as { error?: string };

        if (!response.ok || body.error) {
          throw new Error(body.error ?? `Failed to ${action} expense`);
        }

        closeModal(true);
        router.refresh();
      } catch (submitError) {
        const message =
          submitError instanceof Error
            ? submitError.message
            : `Failed to ${action} expense`;

        setError(message);
        notifyError(message);
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
        disabled={disabled || isSubmitting}
        className={copy.buttonClassName}
        title={copy.title}
        aria-label={copy.title}
      >
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </button>

      {isOpen ? (
        <ModalPortal>
          <div className="modal-shell z-99999 bg-slate-950/50 backdrop-blur-sm">
            <div className="modal-card max-w-lg rounded-[28px] bg-white shadow-1 dark:bg-gray-dark">
              <div className="flex items-start justify-between gap-4 border-b border-stroke px-6 py-5 dark:border-dark-3">
                <div>
                  <h2 className="text-xl font-semibold text-dark dark:text-white">
                    {copy.title}
                  </h2>
                  <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                    {expenseName}
                  </p>
                  <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
                    {copy.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => closeModal()}
                  disabled={isSubmitting}
                  className="app-icon-button disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Close ${copy.title.toLowerCase()} dialog`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-6">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-dark dark:text-white">
                    {copy.noteLabel}
                  </span>
                  <textarea
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    className={`${INPUT_CLASSNAME} min-h-[120px] resize-y`}
                    maxLength={MAX_REVIEW_COMMENT_LENGTH}
                    placeholder={copy.placeholder}
                  />
                  <div className="mt-2 flex items-center justify-between gap-4 text-xs text-dark-5 dark:text-dark-6">
                    <span>Optional. Saved in the expense history.</span>
                    <span>
                      {reviewComment.length}/{MAX_REVIEW_COMMENT_LENGTH}
                    </span>
                  </div>
                </label>

                {error ? (
                  <div className="mt-4 rounded-xl border border-red/20 bg-red/10 px-4 py-3 text-sm text-red">
                    {error}
                  </div>
                ) : null}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => closeModal()}
                    disabled={isSubmitting}
                    className="app-secondary-button-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={
                      action === "approved"
                        ? "inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
                        : "inline-flex items-center gap-2 rounded-full bg-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red/90 disabled:cursor-not-allowed disabled:bg-gray-300"
                    }
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : action === "approved" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                    {copy.submitLabel}
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
