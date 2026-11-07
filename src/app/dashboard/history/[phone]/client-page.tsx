"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Car, Loader2, Mail, Phone, StickyNote } from "lucide-react";
import { JobTypeBadge, StatusPill } from "@/components/brand";
import { DashboardHeader } from "@/components/dashboard/header";
import { useDashboard } from "@/components/dashboard/shell";
import { listByPhone } from "@/lib/data";
import type { Checkin } from "@/lib/types";
import { formatAuPhone, formatDate, normaliseAuPhone, vehicleTitle } from "@/lib/utils";

/** Every check-in from one customer, matched by phone number. */
export default function CustomerHistoryPage() {
  const { phone: raw } = useParams<{ phone: string }>();
  const phone = normaliseAuPhone(decodeURIComponent(raw));
  const { openCheckin, rows } = useDashboard();
  const [list, setList] = useState<Checkin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-query when live rows change so new visits and status changes show up
  const liveKey = rows
    .filter((r) => r.phone === phone)
    .map((r) => `${r.id}:${r.updated_at}`)
    .join("|");
  useEffect(() => {
    let cancelled = false;
    listByPhone(phone)
      .then((d) => !cancelled && setList(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load history"));
    return () => {
      cancelled = true;
    };
  }, [phone, liveKey]);

  const latest = list?.[0];

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader back={{ href: "/dashboard", label: "All check-ins" }} />
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="text-2xl font-bold">Customer history</h1>

        {error && <p className="mt-6 rounded-[12px] bg-red-50 p-4 text-red-700">{error}</p>}
        {!list && !error && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading history…
          </div>
        )}
        {list && list.length === 0 && <p className="py-20 text-center font-semibold">No check-ins for {formatAuPhone(phone)}.</p>}

        {latest && (
          <section className="mt-6 rounded-[20px] border border-line bg-white p-5 shadow-soft">
            <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Customer (latest check-in)</h2>
            <p className="mt-2 text-lg font-bold">{latest.customer_name}</p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
              <a href={`tel:${latest.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                <Phone className="h-4 w-4" aria-hidden="true" /> {formatAuPhone(latest.phone)}
              </a>
              <a href={`mailto:${latest.email}`} className="inline-flex items-center gap-1.5 break-all font-semibold text-primary hover:underline">
                <Mail className="h-4 w-4" aria-hidden="true" /> {latest.email}
              </a>
            </div>
          </section>
        )}

        {list && list.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-muted">
              {list.length} visit{list.length === 1 ? "" : "s"}
            </h2>
            <ol className="space-y-3">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openCheckin(c.id)}
                    className="w-full rounded-[20px] border border-line bg-white p-5 text-left shadow-soft transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-bold">{formatDate(c.created_at)}</p>
                        <p className="font-mono text-xs text-muted">{c.reference_no}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <JobTypeBadge type={c.job_type} />
                        <StatusPill status={c.status} />
                      </div>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                      <Car className="h-4 w-4 text-muted" aria-hidden="true" /> {vehicleTitle(c)}
                    </p>
                    {c.damage_description && <p className="mt-1 text-sm text-muted">{c.damage_description}</p>}
                    {c.internal_notes && (
                      <p className="mt-3 flex gap-2 whitespace-pre-wrap rounded-[12px] bg-slate-50 p-3 text-sm text-slate-700">
                        <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                        {c.internal_notes}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}
