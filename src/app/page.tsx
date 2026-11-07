import Link from "next/link";
import { ArrowRight, LayoutGrid, Lock, Tablet } from "lucide-react";
import { business } from "@config/business";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const portals = [
  {
    href: "/kiosk",
    title: "Customer iPad Form",
    description: "The front-counter check-in form. Customers enter their details, describe the damage and sign.",
    chips: ["Touch friendly", "Digital signature"],
    cta: "Launch iPad Kiosk",
    Icon: Tablet,
    accent: "blue" as const,
  },
  {
    href: "/dashboard",
    title: "Owner Dashboard",
    description: "Every check-in the moment it's submitted. Search, update status, copy details, add notes and print.",
    chips: ["Real-time updates", "Search & filters", "One-tap copy"],
    cta: "Enter Owner Dashboard",
    Icon: LayoutGrid,
    accent: "green" as const,
  },
];

const ACCENT = {
  blue: { card: "border-primary/40 hover:border-primary focus-visible:ring-primary/40", icon: "bg-primary/25 text-white", cta: "bg-primary group-hover:bg-primary-hover text-white" },
  green: { card: "border-success/30 hover:border-success focus-visible:ring-success/40", icon: "bg-success/15 text-success", cta: "bg-success group-hover:bg-emerald-600 text-white" },
};

export default function PortalPage() {
  return (
    <main className="flex min-h-screen flex-col border-t-4 border-primary bg-navy text-white">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 pt-8 sm:px-8">
        <div className="flex items-center gap-4">
          <Logo className="h-20 sm:h-24" />
          <div className="hidden border-l border-white/15 pl-4 sm:block">
            <p className="font-semibold">{business.name}</p>
            <p className="text-sm text-slate-400">Digital Customer Check-in</p>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 py-14 sm:px-8">
        <p className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">{business.location}</p>
        <h1 className="mt-3 text-center text-3xl font-bold tracking-tight sm:text-[42px]">Select Your Workspace Portal</h1>

        <div className="mx-auto mt-12 grid w-full max-w-4xl gap-6 md:grid-cols-2">
          {portals.map(({ href, title, description, chips, cta, Icon, accent }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "group relative flex flex-col rounded-[20px] border bg-navy-800 p-7 transition-all sm:p-9",
                "focus-visible:outline-none focus-visible:ring-4",
                ACCENT[accent].card,
                "hover:-translate-y-0.5",
              )}
            >
              <span
                className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-2xl",
                  ACCENT[accent].icon,
                )}
              >
                <Icon className="h-8 w-8" aria-hidden="true" />
              </span>
              <h2 className="mt-6 text-2xl font-bold">{title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-300">{description}</p>
              <div className="mb-8 mt-5 flex flex-wrap gap-2">
                {chips.map((c) => (
                  <span key={c} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[13px] font-medium text-slate-200">
                    {c}
                  </span>
                ))}
              </div>
              <span
                className={cn(
                  "mt-auto inline-flex h-14 items-center justify-center gap-2 rounded-[12px] text-[17px] font-semibold transition-colors",
                  ACCENT[accent].cta,
                )}
              >
                {cta}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5 text-sm text-slate-400 sm:px-8">
          <span>
            {business.name} · {business.tagline}
          </span>
          <Link href="/login" className="inline-flex items-center gap-1.5 font-semibold text-slate-200 hover:text-white">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Staff Login
          </Link>
        </div>
      </footer>
    </main>
  );
}
