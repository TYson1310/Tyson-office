"use client";

import { ChevronUpIcon } from "@/assets/icons";
import { cn } from "@/lib/utils";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Dropdown, DropdownContent, DropdownTrigger } from "./ui/dropdown";

type PropsType<TItem> = {
  defaultValue?: TItem;
  items?: TItem[];
  sectionKey: string;
  minimal?: boolean;
};

const PARAM_KEY = "selected_time_frame";

export function PeriodPicker<TItem extends string>({
  defaultValue,
  sectionKey,
  items,
  minimal,
}: PropsType<TItem>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dropdown isOpen={isOpen} setIsOpen={setIsOpen}>
      <DropdownTrigger
        className={cn(
          "app-secondary-button-sm flex h-9 w-full justify-between gap-x-1 px-3 text-left text-slate-700 [&>span]:line-clamp-1 [&[data-state='open']>svg]:rotate-0",
          minimal &&
            "border-none bg-transparent p-0 shadow-none backdrop-blur-0",
        )}
      >
        <span className="capitalize">{defaultValue || "Time Period"}</span>

        <ChevronUpIcon className="size-4 rotate-180 transition-transform" />
      </DropdownTrigger>

      <DropdownContent
        align="end"
        className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 min-w-[7rem] overflow-hidden rounded-[20px] border border-slate-200/90 bg-white/95 p-1.5 font-medium text-slate-600 shadow-[0_20px_40px_rgba(15,23,42,0.16)] backdrop-blur-xl"
      >
        <ul>
          {(items || ["monthly", "yearly"]).map((item) => (
            <li key={crypto.randomUUID()}>
              <button
                className="flex w-full select-none items-center truncate rounded-xl px-3 py-2 text-sm capitalize outline-none transition hover:bg-teal-50 hover:text-slate-900"
                onClick={() => {
                  const queryString = createQueryString({
                    sectionKey,
                    value: item,
                    selectedTimeFrame: searchParams.get(PARAM_KEY),
                  });

                  router.push(pathname + queryString, {
                    scroll: false,
                  });

                  setIsOpen(false);
                }}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      </DropdownContent>
    </Dropdown>
  );
}

const createQueryString = (props: {
  sectionKey: string;
  value: string;
  selectedTimeFrame: string | null;
}) => {
  const paramsValue = `${props.sectionKey}:${props.value}`;

  if (!props.selectedTimeFrame) {
    return `?${PARAM_KEY}=${paramsValue}`;
  }

  const newSearchParams = props.selectedTimeFrame
    .split(",")
    .filter((value) => !value.includes(props.sectionKey))
    .join(",");

  if (!newSearchParams) {
    return `?${PARAM_KEY}=${paramsValue}`;
  }

  return `?${PARAM_KEY}=${newSearchParams},${paramsValue}`;
};
