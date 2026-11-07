"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { business } from "@config/business";
import { getKioskSettings, onSettingsChanged } from "@/lib/data";
import { DEFAULT_KIOSK_SETTINGS } from "@/lib/settings";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";
import type { KioskSettings } from "@/lib/types";

interface BrandContext {
  /** Public kiosk settings, kept live over Realtime. */
  kiosk: KioskSettings;
  /** "loading" until the first fetch finishes; "error" if it failed (defaults are used). */
  state: "loading" | "ready" | "error";
  /** From config/business.ts. */
  businessName: string;
  refresh: () => Promise<void>;
}

const Ctx = createContext<BrandContext | null>(null);

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [kiosk, setKiosk] = useState<KioskSettings>(DEFAULT_KIOSK_SETTINGS);
  const [state, setState] = useState<BrandContext["state"]>("loading");

  const refresh = useCallback(async () => {
    try {
      setKiosk(await getKioskSettings());
      setState("ready");
    } catch {
      setState((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    getKioskSettings()
      .then((k) => {
        setKiosk(k);
        setState("ready");
      })
      .catch(() => setState("error"));
    const unsub = onSettingsChanged(refresh);
    // Safety net in case a Realtime message is missed (e.g. the iPad slept)
    const t = setInterval(refresh, 5 * 60_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsub();
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const value = useMemo<BrandContext>(
    () => ({
      kiosk,
      state,
      businessName: business.name,
      refresh,
    }),
    [kiosk, state, refresh],
  );

  // (When Supabase isn't configured the root layout renders <SetupRequired /> instead.)
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBrand must be used inside <BrandProvider>");
  return v;
}
