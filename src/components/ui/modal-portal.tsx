"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalPortalProps = {
  children: ReactNode;
};

const MODAL_PORTAL_COUNT_KEY = "modalPortalCount";
const MODAL_PORTAL_OVERFLOW_KEY = "modalPortalOverflow";

export function ModalPortal({ children }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const { body } = document;
    const currentCount = Number(body.dataset[MODAL_PORTAL_COUNT_KEY] ?? "0");

    if (currentCount === 0) {
      body.dataset[MODAL_PORTAL_OVERFLOW_KEY] = body.style.overflow;
      body.style.overflow = "hidden";
    }

    body.dataset[MODAL_PORTAL_COUNT_KEY] = String(currentCount + 1);

    return () => {
      const nextCount = Number(body.dataset[MODAL_PORTAL_COUNT_KEY] ?? "1") - 1;

      if (nextCount <= 0) {
        body.style.overflow = body.dataset[MODAL_PORTAL_OVERFLOW_KEY] ?? "";
        delete body.dataset[MODAL_PORTAL_COUNT_KEY];
        delete body.dataset[MODAL_PORTAL_OVERFLOW_KEY];
        return;
      }

      body.dataset[MODAL_PORTAL_COUNT_KEY] = String(nextCount);
    };
  }, [mounted]);

  if (!mounted) {
    return null;
  }

  return createPortal(children, document.body);
}
