"use client";

import { Logo } from "@/components/logo";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessPath } from "@/lib/auth/route-access";
import { collapseUserRole } from "@/lib/auth/shared";
import { useStore } from "@/contexts/StoreContext";
import { createStoreHref } from "@/lib/store-query";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_DATA } from "./data";
import { ArrowLeftIcon, ChevronUp } from "./icons";
import { MenuItem } from "./menu-item";
import { useSidebarContext } from "./sidebar-context";

export function Sidebar() {
  const pathname = usePathname();
  const { setIsOpen, isOpen, isMobile, toggleSidebar } = useSidebarContext();
  const { user } = useAuth();
  const { activeStore } = useStore();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const storeId = activeStore?.storeKey ?? user?.storeKey;
  const supportedRole = user?.role ? collapseUserRole(user.role) : null;

  const hasAccess = (roles?: (typeof NAV_DATA)[number]["roles"]) => {
    if (!roles || roles.length === 0) {
      return true;
    }

    if (!supportedRole) {
      return false;
    }

    return roles.includes(supportedRole);
  };

  const hasRouteAccess = (
    url?: string,
    roles?: (typeof NAV_DATA)[number]["roles"],
  ) => {
    if (!hasAccess(roles)) {
      return false;
    }

    if (url) {
      return canAccessPath(url, user?.role, user?.permissions);
    }

    return true;
  };

  const toggleExpanded = (title: string) => {
    setExpandedItems((prev) => (prev.includes(title) ? [] : [title]));
  };

  const filteredNav = NAV_DATA.map((section) => {
    const items = section.items
      .map((item) => {
        const visibleSubItems = item.items.filter((subItem) =>
          hasRouteAccess(subItem.url, subItem.roles),
        );
        const itemIsVisible = hasRouteAccess(item.url, item.roles);

        if (!itemIsVisible && visibleSubItems.length === 0) {
          return null;
        }

        return {
          ...item,
          items: visibleSubItems,
        };
      })
      .filter((item): item is (typeof section.items)[number] => item !== null);

    if (!hasAccess(section.roles) && items.length === 0) {
      return null;
    }

    return {
      ...section,
      items,
    };
  }).filter((section): section is (typeof NAV_DATA)[number] =>
    Boolean(section && section.items.length > 0),
  );

  useEffect(() => {
    const activeParent = filteredNav
      .flatMap((section) => section.items)
      .find((item) => item.items.some((subItem) => subItem.url === pathname));

    if (!activeParent) {
      return;
    }

    setExpandedItems((prev) =>
      prev.includes(activeParent.title) ? prev : [activeParent.title],
    );
  }, [pathname, filteredNav]);

  return (
    <>
      {/* Mobile Overlay */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "relative overflow-hidden border-r border-white/10 bg-slate-950 text-slate-100 shadow-[0_25px_80px_rgba(15,23,42,0.3)] transition-[width] duration-200 ease-linear",
          isMobile ? "fixed bottom-0 top-0 z-50" : "sticky top-0 h-screen",
          isMobile
            ? isOpen
              ? "w-[min(18.5rem,calc(100vw-1rem))]"
              : "w-0"
            : isOpen
              ? "w-[290px]"
              : "w-0",
        )}
        aria-label="Main navigation"
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.22),transparent_62%)]"
        />

        <div className="relative flex h-full flex-col py-6 pl-4 pr-2 sm:py-10 sm:pl-[25px] sm:pr-[7px]">
          <div className="relative pr-4.5">
            <Link
              href={createStoreHref("/", storeId)}
              onClick={() => isMobile && toggleSidebar()}
              className="px-0 py-2.5 min-[850px]:py-0"
            >
              <Logo />
            </Link>

            {isMobile && (
              <button
                onClick={toggleSidebar}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 transition hover:text-white"
              >
                <span className="sr-only">Close Menu</span>

                <ArrowLeftIcon className="ml-auto size-7" />
              </button>
            )}
          </div>

          {/* Navigation */}
          <div className="custom-scrollbar mt-6 flex-1 overflow-y-auto pr-2 sm:pr-3 min-[850px]:mt-10">
            {filteredNav.map((section) => (
              <div key={section.label} className="mb-6">
                <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400 sm:mb-5">
                  {section.label}
                </h2>

                <nav role="navigation" aria-label={section.label}>
                  <ul className="space-y-2">
                    {section.items.map((item) => (
                      <li key={item.title}>
                        {item.items.length ? (
                          <div>
                            <MenuItem
                              isActive={item.items.some(
                                ({ url }) => url === pathname,
                              )}
                              onClick={() => toggleExpanded(item.title)}
                            >
                              <item.icon
                                className="size-6 shrink-0"
                                aria-hidden="true"
                              />

                              <span>{item.title}</span>

                              <ChevronUp
                                className={cn(
                                  "ml-auto rotate-180 transition-transform duration-200",
                                  expandedItems.includes(item.title) &&
                                    "rotate-0",
                                )}
                                aria-hidden="true"
                              />
                            </MenuItem>

                            {expandedItems.includes(item.title) && (
                              <ul
                                className="ml-9 mr-0 space-y-1.5 pb-[15px] pr-0 pt-2"
                                role="menu"
                              >
                                {item.items.map((subItem) => (
                                  <li key={subItem.title} role="none">
                                    <MenuItem
                                      as="link"
                                      href={createStoreHref(
                                        subItem.url,
                                        storeId,
                                      )}
                                      isActive={pathname === subItem.url}
                                    >
                                      <span>{subItem.title}</span>
                                    </MenuItem>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : (
                          (() => {
                            const href =
                              "url" in item
                                ? item.url + ""
                                : "/" +
                                  item.title.toLowerCase().split(" ").join("-");

                            return (
                              <MenuItem
                                className="flex items-center gap-3 py-3"
                                as="link"
                                href={createStoreHref(href, storeId)}
                                isActive={pathname === href}
                              >
                                <item.icon
                                  className="size-6 shrink-0"
                                  aria-hidden="true"
                                />

                                <span>{item.title}</span>
                              </MenuItem>
                            );
                          })()
                        )}
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
