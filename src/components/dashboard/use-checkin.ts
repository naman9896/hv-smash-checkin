"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard/shell";
import { getCheckin } from "@/lib/data";
import type { Checkin } from "@/lib/types";

/** A check-in from the live list, or fetched (e.g. archived) and added to it so edits stay in sync. */
export function useCheckin(id: string): { checkin: Checkin | null; state: "loading" | "ready" | "missing" } {
  const { rows, upsertRow } = useDashboard();
  const fromList = rows.find((r) => r.id === id) ?? null;
  const [state, setState] = useState<"loading" | "ready" | "missing">(fromList ? "ready" : "loading");

  useEffect(() => {
    if (fromList) return;
    let cancelled = false;
    getCheckin(id)
      .then((c) => {
        if (cancelled) return;
        if (c) upsertRow(c);
        setState(c ? "ready" : "missing");
      })
      .catch(() => !cancelled && setState("missing"));
    return () => {
      cancelled = true;
    };
    // Only fetch when it isn't already in the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!fromList]);

  return { checkin: fromList, state: fromList ? "ready" : state };
}
