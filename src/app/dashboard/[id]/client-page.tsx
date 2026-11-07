"use client";

import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CheckinBody, CheckinHero, PrintJobSheetButton } from "@/components/dashboard/checkin-detail";
import { DashboardHeader } from "@/components/dashboard/header";
import { useCheckin } from "@/components/dashboard/use-checkin";

export default function CheckinPage() {
  const { id } = useParams<{ id: string }>();
  const { checkin, state } = useCheckin(id);

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader back={{ href: "/dashboard", label: "All check-ins" }} />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        {state === "loading" && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading check-in…
          </div>
        )}
        {state === "missing" && <p className="py-20 text-center font-semibold">This check-in doesn&apos;t exist or was deleted.</p>}
        {checkin && (
          <>
            <div className="overflow-hidden rounded-[20px] shadow-soft">
              <CheckinHero c={checkin} />
            </div>
            <CheckinBody key={checkin.id} c={checkin} className="mt-5" />
            <PrintJobSheetButton id={checkin.id} className="mt-5" />
          </>
        )}
      </main>
    </div>
  );
}
