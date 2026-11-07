"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LockScreen } from "@/components/dashboard/lock-screen";
import { SideNav } from "@/components/dashboard/side-nav";
import { playChime, unlockAudio } from "@/lib/chime";
import {
  getOwnerEmail,
  getSettings,
  listCheckins,
  runAutoArchive,
  signOut,
  subscribeCheckins,
  subscribeSettings,
  updateCheckin,
  markAllRead,
  type LiveStatus,
} from "@/lib/data";
import { getSupabase } from "@/lib/supabase";
import type { Checkin, Settings } from "@/lib/types";
import { business } from "@config/business";
import { vehicleTitle } from "@/lib/utils";

export const LOCK_KEY = "checkin.locked";

interface DashboardContext {
  email: string;
  settings: Settings;
  setSettings: (s: Settings) => void;
  /** Check-ins, newest first. Archived ones only when `showArchived` is on. */
  rows: Checkin[];
  upsertRow: (c: Checkin) => void;
  removeRows: (ids: string[]) => void;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  live: LiveStatus;
  /** Ids of rows that just arrived over Realtime (for the highlight animation). */
  fresh: Set<string>;
  unread: Checkin[];
  markRead: (id: string) => void;
  markAllAsRead: () => void;
  /** Open a check-in: the drawer on /dashboard, otherwise its own page. */
  selectedId: string | null;
  openCheckin: (id: string | null) => void;
  lock: () => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<DashboardContext | null>(null);

export function useDashboard(): DashboardContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDashboard must be used inside <DashboardShell>");
  return v;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const lastActivity = useRef(0);
  const settingsRef = useRef<Settings | null>(null);
  const pathRef = useRef(pathname);
  const showArchivedRef = useRef(showArchived);
  const liveRef = useRef<LiveStatus>("connecting");
  useEffect(() => {
    settingsRef.current = settings;
    pathRef.current = pathname;
    showArchivedRef.current = showArchived;
  });

  /* ---------- auth ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const e = await getOwnerEmail();
      if (cancelled) return;
      if (!e) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      try {
        const s = await getSettings();
        if (cancelled) return;
        setSettings(s);
        setEmail(e);
        setLocked(sessionStorage.getItem(LOCK_KEY) === "1");
      } catch (err) {
        toast.error("Couldn't load settings", { description: err instanceof Error ? err.message : undefined });
      }
    })();
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.replace("/login");
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [router]);

  /* ---------- data ---------- */
  const fetchRows = useCallback(async (archived: boolean) => {
    try {
      const data = await listCheckins({ archived });
      data.forEach((c) => seen.current.add(c.id));
      setRows(data);
    } catch (e) {
      toast.error("Couldn't load check-ins", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRows(showArchivedRef.current);
  }, [fetchRows]);

  useEffect(() => {
    if (!email) return;
    // Archive old completed check-ins first (no-op unless enabled in Settings → Data)
    runAutoArchive()
      .catch(() => 0)
      .finally(() => fetchRows(showArchived));
  }, [email, showArchived, fetchRows]);

  const openCheckin = useCallback(
    (id: string | null) => {
      if (id && pathRef.current !== "/dashboard") router.push(`/dashboard/${id}`);
      else setSelectedId(id);
    },
    [router],
  );

  /* ---------- realtime ---------- */
  useEffect(() => {
    if (!email) return;
    const unsubSettings = subscribeSettings(setSettings);
    const unsub = subscribeCheckins(
      {
        onInsert: (c) => {
          if (seen.current.has(c.id)) return;
          seen.current.add(c.id);
          setRows((r) => [c, ...r.filter((x) => x.id !== c.id)]);
          setFresh((f) => new Set(f).add(c.id));
          setTimeout(
            () =>
              setFresh((f) => {
                const n = new Set(f);
                n.delete(c.id);
                return n;
              }),
            4000,
          );
          const s = settingsRef.current;
          if (s?.sound_enabled) playChime(s.chime);
          toast.info(`New check-in: ${c.customer_name}`, {
            description: vehicleTitle(c),
            action: { label: "Open", onClick: () => openCheckin(c.id) },
          });
          if (s?.browser_notifications && typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              const n = new Notification(`New check-in – ${business.name}`, {
                body: `${c.customer_name} · ${vehicleTitle(c)}`,
                tag: c.id,
                icon: "/icon-192.png",
              });
              n.onclick = () => {
                window.focus();
                openCheckin(c.id);
              };
            } catch {
              /* some browsers only allow notifications from a service worker */
            }
          }
        },
        onUpdate: (c) =>
          setRows((r) => {
            if (c.is_archived && !showArchivedRef.current) return r.filter((x) => x.id !== c.id);
            return r.some((x) => x.id === c.id) ? r.map((x) => (x.id === c.id ? c : x)) : r;
          }),
        onDelete: (id) => setRows((r) => r.filter((x) => x.id !== id)),
      },
      (s) => {
        // Catch up on anything missed while the socket was down
        if (liveRef.current === "reconnecting" && s === "live") {
          fetchRows(showArchivedRef.current);
        }
        liveRef.current = s;
        setLive(s);
      },
    );
    return () => {
      unsub();
      unsubSettings();
    };
  }, [email, openCheckin, fetchRows]);

  /* ---------- auto-lock ---------- */
  const lock = useCallback(() => {
    sessionStorage.setItem(LOCK_KEY, "1");
    setLocked(true);
  }, []);

  useEffect(() => {
    if (!email) return;
    lastActivity.current = Date.now();
    const bump = () => {
      lastActivity.current = Date.now();
      unlockAudio(); // browsers only allow sound after a user gesture
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const t = setInterval(() => {
      const mins = settingsRef.current?.auto_lock_minutes ?? 0;
      if (mins > 0 && Date.now() - lastActivity.current >= mins * 60_000) lock();
    }, 5000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      clearInterval(t);
    };
  }, [email, lock]);

  const unlock = useCallback(() => {
    sessionStorage.removeItem(LOCK_KEY);
    lastActivity.current = Date.now();
    setLocked(false);
  }, []);

  const logout = useCallback(async () => {
    sessionStorage.removeItem(LOCK_KEY);
    await signOut();
    // Full page load so no signed-in state or prefetched pages survive
    window.location.replace("/login");
  }, []);

  /* ---------- read state ---------- */
  const markRead = useCallback((id: string) => {
    setRows((r) => r.map((x) => (x.id === id && !x.is_read ? { ...x, is_read: true } : x)));
    updateCheckin(id, { is_read: true }).catch(() => {});
  }, []);

  const unread = useMemo(() => rows.filter((r) => !r.is_read && !r.is_archived), [rows]);

  const markAllAsRead = useCallback(() => {
    const ids = unread.map((r) => r.id);
    setRows((r) => r.map((x) => (ids.includes(x.id) ? { ...x, is_read: true } : x)));
    markAllRead(ids).catch((e) => toast.error("Couldn't mark as read", { description: e instanceof Error ? e.message : undefined }));
  }, [unread]);

  const upsertRow = useCallback((c: Checkin) => {
    setRows((r) => (r.some((x) => x.id === c.id) ? r.map((x) => (x.id === c.id ? c : x)) : [c, ...r]));
  }, []);
  const removeRows = useCallback((ids: string[]) => setRows((r) => r.filter((x) => !ids.includes(x.id))), []);

  if (!email || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page">
        <Loader2 className="h-6 w-6 animate-spin text-muted" aria-label="Loading" />
      </div>
    );
  }

  const value: DashboardContext = {
    email,
    settings,
    setSettings,
    rows,
    upsertRow,
    removeRows,
    loading,
    refreshing,
    refresh,
    showArchived,
    setShowArchived,
    live,
    fresh,
    unread,
    markRead,
    markAllAsRead,
    selectedId,
    openCheckin,
    lock,
    logout,
  };

  // Print pages are a bare A4 sheet: no menu
  const showNav = !pathname.endsWith("/print");

  return (
    <Ctx.Provider value={value}>
      <div inert={locked} aria-hidden={locked || undefined} className={showNav ? "lg:flex" : undefined}>
        {showNav && <SideNav />}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {locked && (
        <LockScreen
          email={email}
          onUnlock={unlock}
          onForceLogout={logout}
        />
      )}
    </Ctx.Provider>
  );
}
