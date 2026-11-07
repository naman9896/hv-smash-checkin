import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ManageBooking, ManageProblem } from "@/components/booking/manage-booking";
import { viewByToken } from "@/lib/booking/manage-server";
import { logFailure } from "@/lib/booking/http";

export const metadata: Metadata = {
  title: "Your booking – Sai Motor Works",
  robots: { index: false, follow: false },
  referrer: "no-referrer", // the header is set in next.config.ts too
};

/**
 * /b/{token} — the customer's manage page (API_SPEC §1; BUSINESS_RULES §9). The token is read
 * at request time behind Suspense, so a bad link renders not-found.tsx (noindex; the stream has
 * already started, so the status is 200 — /api/booking/manage returns a real 404).
 */
export default function Page({ params }: PageProps<"/b/[token]">) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16 text-muted" role="status">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /><span className="sr-only">Loading your booking</span>
        </div>
      }
    >
      <Manage params={params} />
    </Suspense>
  );
}

async function Manage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let r;
  try {
    r = await viewByToken(token);
  } catch (err) {
    logFailure("manage page", err);
    return <ManageProblem />;
  }
  if (!r.ok) {
    if (r.error.code === "P0001" && r.error.message === "NOT_FOUND") notFound();
    logFailure("manage page", r.error);
    return <ManageProblem />;
  }
  return <ManageBooking token={token} initial={r.view} />;
}
