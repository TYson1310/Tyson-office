"use client";

import type { ReactNode } from "react";
import { ModalPortal } from "@/components/ui/modal-portal";

type VendorModalProps = {
  children: ReactNode;
};

export function VendorModal({ children }: VendorModalProps) {
  return <ModalPortal>{children}</ModalPortal>;
}
