import { cn } from "@/lib/utils";
import { Briefcase, ShieldCheck } from "lucide-react";
import { JOB_TYPE_LABEL, STATUS_LABEL, type CheckinStatus, type JobType } from "@/lib/types";

const STATUS_STYLE: Record<CheckinStatus, string> = {
  new: "bg-primary/10 text-primary ring-primary/25",
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

/** "Insurance" / "Private" badge. Nothing when the customer didn't say. */
export function JobTypeBadge({ type, dark, className }: { type: JobType | null; dark?: boolean; className?: string }) {
  if (!type) return null;
  const Icon = type === "insurance" ? ShieldCheck : Briefcase;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        type === "insurance"
          ? dark
            ? "bg-white/15 text-white"
            : "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25"
          : dark
            ? "bg-white/10 text-slate-200"
            : "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {JOB_TYPE_LABEL[type]}
    </span>
  );
}
