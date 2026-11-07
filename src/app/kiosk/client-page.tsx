"use client";

import dynamic from "next/dynamic";
import { KioskLockdown } from "@/components/kiosk/lockdown";

// The kiosk is a purely client-side, touch-driven screen (idle timers,
// idle timers, today's year as a default) – render it only in the browser.
const KioskForm = dynamic(() => import("./kiosk-form"), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-page" />,
});

export default function KioskPage() {
  return (
    <>
      <KioskLockdown />
      <KioskForm />
    </>
  );
}
