"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, CheckCheck, Lock, LogOut, RefreshCw, Settings as SettingsIcon, Tablet } from "lucide-react";
import { useDashboard } from "@/components/dashboard/shell";
import { MobileNav } from "@/components/dashboard/side-nav";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";

export function DashboardHeader({ back }: { back?: { href: string; label: string } }) {
  const { live, unread, refresh, refreshing, lock, logout, openCheckin, markAllAsRead } = useDashboard();
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bellOpen) return;
    const close = (e: PointerEvent) => !bellRef.current?.contains(e.target as Node) && setBellOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setBellOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [bellOpen]);

  const liveLabel = live === "live" ? "Live" : live === "reconnecting" ? "Reconnecting…" : "Connecting…";

  return (
    <header className="no-print sticky top-0 z-30 bg-navy text-white shadow-lg">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard" className="shrink-0 rounded-[8px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20">
            <Logo className="h-11 sm:h-12" />
          </Link>
          <div className="min-w-0">
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">Owner Dashboard</span>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-400" aria-live="polite">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  live === "live" ? "live-dot bg-success" : live === "reconnecting" ? "animate-pulse bg-warning" : "bg-slate-500",
                )}
                aria-hidden="true"
              />
              <span className={cn(live === "live" && "font-semibold text-success", live === "reconnecting" && "font-semibold text-warning")}>
                {liveLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="relative" ref={bellRef}>
            <button
              type="button"
              className="relative inline-flex h-11 w-11 items-center justify-center rounded-[12px] text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20"
              aria-label={`Notifications: ${unread.length} unread`}
              aria-expanded={bellOpen}
              onClick={() => setBellOpen((o) => !o)}
            >
              <Bell className="h-5 w-5" />
              {unread.length > 0 && (
                <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">
                  {unread.length > 99 ? "99+" : unread.length}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-12 z-40 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-[16px] border border-line bg-white text-ink shadow-2xl">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <p className="text-sm font-bold">Unread check-ins</p>
                  {unread.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        markAllAsRead();
                        setBellOpen(false);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                    </button>
                  )}
                </div>
                {unread.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted">You&apos;re all caught up.</p>
                ) : (
                  <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                    {unread.slice(0, 20).map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setBellOpen(false);
                            openCheckin(c.id);
                          }}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              {c.first_name} {c.last_name}
                            </span>
                            <span className="block truncate text-xs text-muted">
                              <span className="font-mono font-bold">{c.rego}</span> · {c.make} {c.model}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted">{timeAgo(c.created_at)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <Button variant="dark" size="icon" onClick={refresh} aria-label="Refresh">
            <RefreshCw className={cn(refreshing && "animate-spin")} />
          </Button>
          <Button asChild variant="default" className="hidden md:inline-flex">
            <Link href="/kiosk" target="_blank">
              <Tablet /> Open iPad Kiosk
            </Link>
          </Button>
          <Button asChild variant="dark" size="icon" className="md:hidden">
            <Link href="/kiosk" target="_blank" aria-label="Open iPad Kiosk">
              <Tablet />
            </Link>
          </Button>
          <Button asChild variant="dark" size="icon">
            <Link href="/dashboard/settings" aria-label="Settings">
              <SettingsIcon />
            </Link>
          </Button>
          <Button variant="dark" size="icon" onClick={lock} aria-label="Lock dashboard">
            <Lock />
          </Button>
          <Button variant="dark" size="icon" onClick={logout} aria-label="Log out">
            <LogOut />
          </Button>
        </div>
      </div>
      <MobileNav />
      {back && (
        <div className="border-t border-white/10">
          <div className="mx-auto max-w-7xl px-4 py-2 sm:px-6">
            <Link href={back.href} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-300 hover:text-white">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {back.label}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
