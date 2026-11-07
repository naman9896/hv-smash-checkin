"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard/shell";
import { getJob } from "@/lib/data";
import type { Job } from "@/lib/types";

/** A job from the live list, or fetched and added to it. */
export function useJob(id: string): { job: Job | null; state: "loading" | "ready" | "missing" } {
  const { jobs, jobsLoading, upsertJob } = useDashboard();
  const fromList = jobs.find((j) => j.id === id) ?? null;
  const [state, setState] = useState<"loading" | "ready" | "missing">(fromList ? "ready" : "loading");

  useEffect(() => {
    if (fromList || jobsLoading) return;
    let cancelled = false;
    getJob(id)
      .then((j) => {
        if (cancelled) return;
        if (j) upsertJob(j);
        setState(j ? "ready" : "missing");
      })
      .catch(() => !cancelled && setState("missing"));
    return () => {
      cancelled = true;
    };
    // Only fetch when it isn't already in the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!fromList, jobsLoading]);

  return { job: fromList, state: fromList ? "ready" : state };
}
