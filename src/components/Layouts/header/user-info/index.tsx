"use client";

import { ChevronUpIcon } from "@/assets/icons";
import {
  Dropdown,
  DropdownContent,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { useAuth } from "@/contexts/AuthContext";
import { useStore } from "@/contexts/StoreContext";
import { createStoreHref } from "@/lib/store-query";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOutIcon, SettingsIcon, UserIcon } from "./icons";

export function UserInfo() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { user, logout } = useAuth();
  const { activeStore, isAdmin } = useStore();
  const storeId = activeStore?.storeKey ?? user?.storeKey;
  const isAdminUser = user?.role === "admin";

  const handleLogout = async () => {
    await logout();
    router.push("/auth/login");
    setIsOpen(false);
  };

  // Default user info if not authenticated
  const USER = {
    name: user?.name || "User",
    email: user?.email || "user@example.com",
    role: user?.role || "employee",
    img: user?.avatar || "/images/user/user-03.png",
  };

  return (
    <Dropdown isOpen={isOpen} setIsOpen={setIsOpen}>
      <DropdownTrigger className="rounded-full align-middle outline-none ring-primary ring-offset-2 ring-offset-white focus-visible:ring-2">
        <span className="sr-only">My Account</span>

        <figure className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/70 p-1 pr-2 shadow-sm backdrop-blur sm:gap-3 sm:p-1.5 sm:pr-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-950 via-teal-700 to-cyan-500 text-sm font-bold text-white sm:h-12 sm:w-12 sm:text-base">
            {USER.name.charAt(0).toUpperCase()}
          </div>
          <figcaption className="hidden items-center gap-1 font-medium text-dark lg:flex">
            <span>{USER.name}</span>

            <ChevronUpIcon
              aria-hidden
              className={cn(
                "rotate-180 transition-transform",
                isOpen && "rotate-0",
              )}
              strokeWidth={1.5}
            />
          </figcaption>
        </figure>
      </DropdownTrigger>

      <DropdownContent
        className="w-[min(20rem,calc(100vw-1rem))] rounded-[24px] border border-slate-200/80 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl min-[230px]:min-w-[17.5rem]"
        align="end"
      >
        <h2 className="sr-only">User information</h2>

        <figure className="m-2 flex items-center gap-2.5 rounded-[20px] bg-slate-50/80 px-5 py-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-slate-950 via-teal-700 to-cyan-500 text-lg font-bold text-white">
            {USER.name.charAt(0).toUpperCase()}
          </div>

          <figcaption className="space-y-1 text-base font-medium">
            <div className="mb-2 leading-none text-dark">{USER.name}</div>

            <div className="leading-none text-gray-6">{USER.email}</div>
            <div className="text-xs font-semibold uppercase text-primary">
              {USER.role}
            </div>
            {activeStore ? (
              <div className="text-[11px] text-dark-5">{activeStore.name}</div>
            ) : null}
          </figcaption>
        </figure>

        <hr className="border-slate-200/80" />

        <div className="p-2 text-base text-slate-600 [&>*]:cursor-pointer">
          {isAdminUser ? (
            <Link
              href={createStoreHref("/admin/settings", storeId)}
              onClick={() => setIsOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-[9px] transition hover:bg-teal-50 hover:text-dark"
            >
              <SettingsIcon />

              <span className="mr-auto text-base font-medium">Settings</span>
            </Link>
          ) : (
            <Link
              href={createStoreHref("/employee/profile", storeId)}
              onClick={() => setIsOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-[9px] transition hover:bg-teal-50 hover:text-dark"
            >
              <UserIcon />

              <span className="mr-auto text-base font-medium">
                View profile
              </span>
            </Link>
          )}

          {isAdmin ? (
            <Link
              href="/admin/store-selection"
              onClick={() => setIsOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-[9px] transition hover:bg-teal-50 hover:text-dark"
            >
              <SettingsIcon />
              <span className="mr-auto text-base font-medium">
                Switch store
              </span>
            </Link>
          ) : null}
        </div>

        <hr className="border-slate-200/80" />

        <div className="p-2 text-base text-slate-600">
          <button
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-[9px] transition hover:bg-red-50 hover:text-red-600"
            onClick={handleLogout}
          >
            <LogOutIcon />

            <span className="text-base font-medium">Log out</span>
          </button>
        </div>
      </DropdownContent>
    </Dropdown>
  );
}
