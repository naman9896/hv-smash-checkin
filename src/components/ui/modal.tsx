"use client";
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/** Centred dialog in the same card style as the rest of the app. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (dismissible || o) && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="no-print fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "no-print fixed left-1/2 top-1/2 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[20px] bg-white p-7 text-center shadow-2xl outline-none",
            className,
          )}
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
        >
          {icon && <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full [&_svg]:h-8 [&_svg]:w-8">{icon}</div>}
          <Dialog.Title className="text-2xl font-bold text-ink">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-2 text-[15px] text-muted">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
