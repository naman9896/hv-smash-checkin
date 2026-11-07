import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/shell";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-page">
          <Loader2 className="h-6 w-6 animate-spin text-muted" aria-label="Loading" />
        </div>
      }
    >
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
