import { cn } from "@/lib/utils";
import { STATUS_LABEL, type CheckinStatus } from "@/lib/types";

const STATUS_STYLE: Record<CheckinStatus, string> = {
  new: "bg-blue-50 text-blue-700 ring-blue-200",
  in_progress: "bg-amber-50 text-amber-800 ring-amber-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};
const STATUS_DOT: Record<CheckinStatus, string> = {
  new: "bg-primary",
  in_progress: "bg-warning",
  completed: "bg-success",
  cancelled: "bg-slate-400",
};

export function StatusPill({ status, className }: { status: CheckinStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset whitespace-nowrap",
        STATUS_STYLE[status],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Yellow NSW-style number plate. */
export function Plate({ rego, size = "md" }: { rego: string; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex flex-col items-center justify-center rounded-[8px] border-2 border-slate-900 bg-plate font-mono font-bold leading-none tracking-[0.12em] text-slate-900 shadow-[inset_0_0_0_2px_#FACC15,inset_0_0_0_3px_rgb(15_23_42/0.35)]",
        size === "md" ? "h-11 min-w-[104px] px-2.5 text-[17px]" : "h-16 min-w-[160px] px-4 text-[26px]",
      )}
    >
      <span className={cn("font-sans font-bold tracking-[0.2em] text-slate-700", size === "md" ? "text-[7px] mb-0.5" : "text-[9px] mb-1")}>
        NSW
      </span>
      {rego}
    </span>
  );
}
