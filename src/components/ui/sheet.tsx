"use client";
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;

export function SheetContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="no-print fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <Dialog.Content
        className={cn(
          "no-print fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col bg-page shadow-2xl outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
