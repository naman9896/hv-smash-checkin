"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Building2, Database, ShieldCheck, Tablet } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/header";
import { BusinessTab } from "@/components/settings/business-tab";
import { DataTab } from "@/components/settings/data-tab";
import { KioskTab } from "@/components/settings/kiosk-tab";
import { NotificationsTab } from "@/components/settings/notifications-tab";
import { SecurityTab } from "@/components/settings/security-tab";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "business", label: "Business Details", Icon: Building2, Comp: BusinessTab },
  { id: "security", label: "Security", Icon: ShieldCheck, Comp: SecurityTab },
  { id: "kiosk", label: "Kiosk", Icon: Tablet, Comp: KioskTab },
  { id: "notifications", label: "Notifications", Icon: Bell, Comp: NotificationsTab },
  { id: "data", label: "Data", Icon: Database, Comp: DataTab },
] as const;
type TabId = (typeof TABS)[number]["id"];

const LEAVE_MSG = "You have unsaved changes. Leave without saving?";

export default function SettingsPage() {
  // Remember the tab in the URL hash so a refresh stays put
  const [tab, setTab] = useState<TabId>(() => {
    const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
    return TABS.find((t) => t.id === h)?.id ?? "business";
  });
  const [dirty, setDirty] = useState(false);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);

  // Warn before leaving with unsaved changes (reload/close, and in-app links)
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(LEAVE_MSG)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function switchTab(id: TabId) {
    if (id === tab) return;
    if (dirty && !window.confirm(LEAVE_MSG)) return;
    setDirty(false);
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  }

  const Active = TABS.find((t) => t.id === tab)!.Comp;

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader back={{ href: "/dashboard", label: "Back to dashboard" }} />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div
          role="tablist"
          aria-label="Settings sections"
          className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
          onKeyDown={(e) => {
            const i = TABS.findIndex((t) => t.id === tab);
            if (e.key === "ArrowRight") switchTab(TABS[(i + 1) % TABS.length].id);
            if (e.key === "ArrowLeft") switchTab(TABS[(i - 1 + TABS.length) % TABS.length].id);
          }}
        >
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => switchTab(id)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25",
                tab === id ? "border-navy bg-navy text-white" : "border-line bg-white text-ink hover:bg-slate-50",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-6">
          <Active key={tab} onDirty={onDirty} />
        </div>
      </main>
    </div>
  );
}
