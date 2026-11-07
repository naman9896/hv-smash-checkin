"use client";

import Link from "next/link";
import { Maximize2 } from "lucide-react";
import { CheckinBody, CheckinHero, PrintJobSheetButton } from "@/components/dashboard/checkin-detail";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { Checkin } from "@/lib/types";

export function CheckinDrawer({ checkin, onOpenChange }: { checkin: Checkin | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={!!checkin} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        {checkin && (
          <>
            <CheckinHero c={checkin} Title={SheetTitle} />
            <CheckinBody key={checkin.id} c={checkin} className="flex-1 overflow-y-auto p-5 sm:p-6" />
            <div className="flex gap-2 border-t border-line bg-white p-4 sm:px-6">
              <PrintJobSheetButton id={checkin.id} className="flex-1" />
              <Button asChild variant="outline" size="lg" aria-label="Open full page">
                <Link href={`/dashboard/${checkin.id}`}>
                  <Maximize2 />
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
