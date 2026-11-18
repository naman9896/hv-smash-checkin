"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, Settings as SettingsIcon } from "lucide-react";
import { useDashboard } from "@/components/dashboard/shell";
import { cn } from "@/lib/utils";

type Section = "checkins" | "settings";

function sectionOf(pathname: string): Section {
  if (pathname.startsWith("/dashboard/settings")) return "settings";
  return "checkins";
}

function useNavItems() {
  const { unread } = useDashboard();
  const active = sectionOf(usePathname());
  return [
    { id: "checkins", href: "/dashboard", label: "Check-ins", Icon: ClipboardCheck, badge: unread.length },
    { id: "settings", href: "/dashboard/settings", label: "Settings", Icon: SettingsIcon, badge: 0 },
  ].map((i) => ({ ...i, active: i.id === active }));
}

function Badge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cn("ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold tabular-nums text-white", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Left-hand menu on large screens. */
export function SideNav() {
  const items = useNavItems();
  return (
    <nav aria-label="Dashboard" className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white px-3 py-6 lg:flex">
      <p className="px-3 pb-2 text-xs font-medium text-muted">Dashboard</p>
      <ul className="space-y-0.5">
        {items.map(({ id, href, label, Icon, badge, active }) => (
          <li key={id} className={id === "settings" ? "mt-3 border-t border-line pt-3" : undefined}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-[8px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
                active ? "bg-ink/[0.06] text-ink" : "text-muted hover:bg-slate-100 hover:text-ink",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              {label}
              <Badge n={badge} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The same menu as tabs under the header on phones and iPads. */
export function MobileNav() {
  const items = useNavItems().filter((i) => i.id !== "settings");
  return (
    <nav aria-label="Dashboard" className="border-t border-white/10 lg:hidden">
      <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
        {items.map(({ id, href, label, Icon, badge, active }) => (
          <li key={id} className="shrink-0">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                active ? "border-primary text-white" : "border-transparent text-slate-400 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
              <Badge n={badge} className="ml-1" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
