import { BRAND } from "@/lib/brand";

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-[18px] bg-gradient-to-br from-teal-500 via-teal-600 to-cyan-500 font-black text-white shadow-[0_18px_32px_rgba(13,148,136,0.35)]">
        {BRAND.mark}
      </div>

      <div className="min-w-0">
        <div className="truncate text-base font-bold leading-none text-white">
          {BRAND.name}
        </div>
        <div className="mt-1 hidden text-xs font-semibold uppercase tracking-[0.24em] text-teal-200 min-[360px]:block">
          {BRAND.platformLabel}
        </div>
      </div>
    </div>
  );
}
