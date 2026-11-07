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
    { id: "checkins", href: "/dashboard", label: "Customer Check-ins", Icon: ClipboardCheck, badge: unread.length },
    { id: "settings", href: "/dashboard/settings", label: "Settings", Icon: SettingsIcon, badge: 0 },
  ].map((i) => ({ ...i, active: i.id === active }));
}

function Badge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cn("ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Left-hand menu on large screens. */
export function SideNav() {
  const items = useNavItems();
  return (
    <nav aria-label="Dashboard" className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white px-3 py-5 lg:flex">
      <p className="px-3 pb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted">Dashboard</p>
      <ul className="space-y-1">
        {items.map(({ id, href, label, Icon, badge, active }) => (
          <li key={id} className={id === "settings" ? "mt-4 border-t border-line pt-4" : undefined}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-[12px] px-3 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
                active ? "bg-navy text-white" : "text-ink hover:bg-slate-100",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
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
                "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors",
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
