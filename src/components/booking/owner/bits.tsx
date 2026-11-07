import { AlertTriangle, Check, Clock, MessageSquare } from "lucide-react";
import { BOOKING_STATUS_LABEL, type BookingStatus, type SmsSummary } from "@/lib/booking/owner";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<BookingStatus, { pill: string; dot: string }> = {
  booked: { pill: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-primary" },
  arrived: { pill: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-warning" },
  completed: { pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-success" },
  cancelled: { pill: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400" },
  no_show: { pill: "bg-red-50 text-red-700 ring-red-200", dot: "bg-danger" },
};

export function BookingStatusPill({ status, className }: { status: BookingStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", s.pill, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden="true" />
      {BOOKING_STATUS_LABEL[status]}
    </span>
  );
}

export function NotArrivedPill() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200">
      <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Not arrived
    </span>
  );
}

const SMS: Record<Exclude<SmsSummary, "none">, { label: string; cls: string; Icon: typeof Check }> = {
  failed: { label: "SMS failed", cls: "text-red-700", Icon: AlertTriangle },
  queued: { label: "SMS queued", cls: "text-muted", Icon: MessageSquare },
  sent: { label: "SMS sent", cls: "text-emerald-700", Icon: Check },
};

export function SmsBadge({ summary }: { summary: SmsSummary }) {
  if (summary === "none") return null;
  const { label, cls, Icon } = SMS[summary];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold", cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </span>
  );
}
