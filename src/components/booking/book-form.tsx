"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Car, Check, CheckCircle2, ClipboardList, Loader2, MessageSquare, Phone, Plus, User } from "lucide-react";
import { Logo } from "@/components/logo";
import { MakeSelect } from "@/components/make-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDay, formatDayLong, formatPrice, formatWindow, telHref } from "@/lib/booking/format";
import {
  MAX_NOTES, MAX_SERVICES, PublicCreateBooking, REGO_STATES,
  type CreatedBooking, type PublicDay, type PublicInfo,
} from "@/lib/booking/schemas";
import { addDaysIso, sydneyToday } from "@/lib/booking/dates";
import { cn, formatAuMobile } from "@/lib/utils";

const STEPS = [
  { title: "What do you need?", icon: ClipboardList, paths: ["serviceIds"] },
  { title: "Pick a drop-off day", icon: CalendarDays, paths: ["date", "windowId"] },
  { title: "Your vehicle", icon: Car, paths: ["vehicle"] },
  { title: "Your details", icon: User, paths: ["customer"] },
  { title: "Anything we should know?", icon: MessageSquare, paths: ["notes"] },
  { title: "Check and book", icon: Check, paths: [] },
] as const;

type Fields = {
  rego: string; state: string; make: string; makeOther: boolean; model: string; year: string;
  firstName: string; lastName: string; mobile: string; email: string; notes: string;
};
const blank: Fields = {
  rego: "", state: "NSW", make: "", makeOther: false, model: "", year: "",
  firstName: "", lastName: "", mobile: "", email: "", notes: "",
};

type ApiError = { code: string; message: string; issues?: { path: string; message: string }[] };
const DAY_ERRORS = new Set(["FULL", "CLOSED", "CUTOFF_PASSED", "OUTSIDE_HORIZON"]);

export function BookForm() {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [paused, setPaused] = useState<{ phone: string | null } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState(0);
  const [services, setServices] = useState<string[]>([]);
  const [days, setDays] = useState<PublicDay[] | null>(null);
  const [date, setDate] = useState("");
  const [windowId, setWindowId] = useState("");
  const [f, setF] = useState<Fields>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<CreatedBooking | null>(null);

  // ---- data ----
  useEffect(() => {
    let live = true;
    fetch("/api/booking/info")
      .then(async (r) => {
        const body = await r.json();
        if (!live) return;
        if (r.status === 503) setPaused({ phone: body.business?.phone ?? null });
        else if (r.ok) {
          setInfo(body as PublicInfo);
          setWindowId((body as PublicInfo).windows[0]?.id ?? "");
        } else setLoadError(true);
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, []);

  const loadDays = useCallback(async () => {
    setDays(null);
    const from = addDaysIso(sydneyToday(), 1);
    const r = await fetch(`/api/booking/availability?from=${from}&to=${addDaysIso(from, 30)}`).catch(() => null);
    if (!r?.ok) {
      setDays([]);
      setBanner("We couldn't load the available days. Please try again.");
      return;
    }
    setDays(((await r.json()) as { days: PublicDay[] }).days);
  }, []);

  // ---- validation (same schema as the server) ----
  const payload = useMemo(
    () => ({
      serviceIds: services,
      date,
      windowId,
      customer: { firstName: f.firstName, lastName: f.lastName, mobile: f.mobile, email: f.email },
      vehicle: { rego: f.rego, state: f.state, make: f.make, model: f.model, year: f.year },
      notes: f.notes,
    }),
    [services, date, windowId, f],
  );

  function issuesFor(stepIndex: number): Record<string, string> {
    const r = PublicCreateBooking.safeParse(payload);
    if (r.success) return {};
    const prefixes = STEPS[stepIndex].paths as readonly string[];
    const out: Record<string, string> = {};
    for (const i of r.error.issues) {
      const path = i.path.join(".");
      if (prefixes.some((p) => path === p || path.startsWith(`${p}.`))) out[path] ??= i.message;
    }
    if (stepIndex === 1 && out.date) out.date = "Please choose a day";
    return out;
  }

  function stepOf(path: string): number {
    const i = STEPS.findIndex((s) => (s.paths as readonly string[]).some((p) => path === p || path.startsWith(`${p}.`)));
    return i < 0 ? 0 : i;
  }

  function next() {
    const e = issuesFor(step);
    setErrors(e);
    setBanner(null);
    if (Object.keys(e).length) {
      setTimeout(() => document.querySelector<HTMLElement>("[aria-invalid=true], [data-error]")?.focus(), 0);
      return;
    }
    go(step + 1);
  }

  function go(s: number) {
    if (s === 1 && days === null) void loadDays();
    setStep(s);
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    // Re-check every step before sending
    for (let s = 0; s < STEPS.length - 1; s++) {
      const e = issuesFor(s);
      if (Object.keys(e).length) {
        go(s);
        setErrors(e);
        return;
      }
    }
    setSubmitting(true);
    setBanner(null);
    try {
      const r = await fetch("/api/booking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 201) {
        setDone(body as CreatedBooking);
        window.scrollTo({ top: 0 });
        return;
      }
      const err: ApiError = body.error ?? { code: "SERVER_ERROR", message: "Something went wrong. Please try again." };
      if (DAY_ERRORS.has(err.code)) {
        setDate("");
        void loadDays();
        go(1);
      } else if (err.code === "VALIDATION" && err.issues?.length) {
        const e: Record<string, string> = {};
        for (const i of err.issues) e[i.path] ??= i.message;
        go(stepOf(err.issues[0].path));
        setErrors(e);
      } else if (err.code === "BOOKING_OFF") {
        setPaused({ phone: info?.business.phone ?? null });
      }
      setBanner(err.message);
    } catch {
      setBanner("We couldn't reach the workshop. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((x) => ({ ...x, [k]: v }));
  const phone = info?.business.phone ?? paused?.phone ?? null;

  // ---- screens ----
  if (paused) return <Shell><Paused phone={paused.phone} /></Shell>;
  if (loadError) return <Shell><Notice title="Booking isn't available right now" phone={phone} /></Shell>;
  if (!info) {
    return (
      <Shell>
        <div className="flex justify-center py-16 text-muted" role="status">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading</span>
        </div>
      </Shell>
    );
  }
  if (done) return <Shell><Done booking={done} info={info} /></Shell>;

  const chosen = info.services.filter((s) => services.includes(s.id));
  const win = info.windows.find((w) => w.id === windowId);
  const StepIcon = STEPS[step].icon;

  return (
    <Shell>
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between text-sm text-muted">
          <span>Step {step + 1} of {STEPS.length}</span>
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} className="inline-flex min-h-11 items-center gap-1 px-2 font-semibold text-primary">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </button>
          )}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Booking progress"
          aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      <Card className="p-5 sm:p-7">
        <h1 className="mb-5 flex items-center gap-3 text-[22px] font-bold text-ink">
          <StepIcon className="h-6 w-6 text-primary" aria-hidden="true" />
          {STEPS[step].title}
        </h1>

        {banner && (
          <div role="alert" className="mb-4 rounded-[12px] border border-danger/30 bg-red-50 px-4 py-3 text-[15px] text-red-800">
            {banner}
          </div>
        )}

        {step === 0 && (
          <fieldset>
            <legend className="sr-only">Services</legend>
            <ul className="space-y-3">
              {info.services.map((s) => {
                const on = services.includes(s.id);
                const full = !on && services.length >= MAX_SERVICES;
                return (
                  <li key={s.id}>
                    <label className={cn(
                      "flex min-h-16 cursor-pointer items-center gap-4 rounded-[14px] border-2 px-4 py-3 transition-colors",
                      on ? "border-primary bg-primary/5" : "border-line bg-white hover:border-slate-300",
                      full && "cursor-not-allowed opacity-50",
                    )}>
                      <input type="checkbox" className="h-6 w-6 shrink-0 accent-[var(--color-primary)]" checked={on} disabled={full}
                        onChange={(e) => setServices((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))} />
                      <span className="flex-1">
                        <span className="block text-[17px] font-semibold text-ink">{s.name}</span>
                        {s.description && <span className="block text-sm text-muted">{s.description}</span>}
                      </span>
                      <span className="text-right text-sm font-semibold text-muted">{formatPrice(s.priceType, s.priceCents)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <FieldError msg={errors.serviceIds} />
            <p className="mt-4 text-sm text-muted">{info.priceDisclaimer}</p>
          </fieldset>
        )}

        {step === 1 && (
          <div>
            {days === null ? (
              <div className="flex justify-center py-10 text-muted" role="status">
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /><span className="sr-only">Loading days</span>
              </div>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Drop-off days">
                {days.map((d) => (
                  <li key={d.date}>
                    <DayTile day={d} selected={date === d.date} phone={phone} onPick={() => { setDate(d.date); setErrors({}); }} />
                  </li>
                ))}
              </ul>
            )}
            <FieldError msg={errors.date} />
            {info.windows.length > 1 ? (
              <fieldset className="mt-5">
                <legend className="mb-2 text-[15px] font-semibold">Drop-off time</legend>
                {info.windows.map((w) => (
                  <label key={w.id} className="mb-2 flex min-h-12 items-center gap-3 rounded-[12px] border border-line px-4">
                    <input type="radio" name="window" checked={windowId === w.id} onChange={() => setWindowId(w.id)} />
                    {formatWindow(w.start, w.end)}
                  </label>
                ))}
              </fieldset>
            ) : win && (
              <p className="mt-5 rounded-[12px] bg-page px-4 py-3 text-[15px]">
                Drop off between <strong>{formatWindow(win.start, win.end)}</strong>. {info.pickupMessage}
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Field id="rego" label="Registration" error={errors["vehicle.rego"]}>
              <Input id="rego" value={f.rego} autoCapitalize="characters" autoComplete="off" maxLength={12}
                className="h-14 font-mono uppercase tracking-wider" invalid={!!errors["vehicle.rego"]}
                aria-describedby="rego-err" onChange={(e) => set("rego", e.target.value.toUpperCase())} />
            </Field>
            <Field id="state" label="State" error={errors["vehicle.state"]}>
              <select id="state" value={f.state} onChange={(e) => set("state", e.target.value)}
                className="h-14 w-full rounded-[12px] border border-line bg-white px-4 text-[17px]">
                {REGO_STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field id="make" label="Make" error={errors["vehicle.make"]}>
              <MakeSelect id="make" value={f.make} other={f.makeOther} invalid={!!errors["vehicle.make"]} describedBy="make-err"
                onPick={(v, other) => setF((x) => ({ ...x, make: v, makeOther: other }))} onType={(v) => set("make", v)} />
            </Field>
            <Field id="model" label="Model" error={errors["vehicle.model"]}>
              <Input id="model" value={f.model} maxLength={80} autoCapitalize="words" className="h-14"
                invalid={!!errors["vehicle.model"]} aria-describedby="model-err" onChange={(e) => set("model", e.target.value)} />
            </Field>
            <Field id="year" label="Year (optional)" error={errors["vehicle.year"]}>
              <Input id="year" value={f.year} inputMode="numeric" maxLength={4} className="h-14"
                invalid={!!errors["vehicle.year"]} aria-describedby="year-err" onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Field id="firstName" label="First name" error={errors["customer.firstName"]}>
              <Input id="firstName" value={f.firstName} autoComplete="given-name" maxLength={80} className="h-14"
                invalid={!!errors["customer.firstName"]} aria-describedby="firstName-err" onChange={(e) => set("firstName", e.target.value)} />
            </Field>
            <Field id="lastName" label="Last name" error={errors["customer.lastName"]}>
              <Input id="lastName" value={f.lastName} autoComplete="family-name" maxLength={80} className="h-14"
                invalid={!!errors["customer.lastName"]} aria-describedby="lastName-err" onChange={(e) => set("lastName", e.target.value)} />
            </Field>
            <Field id="mobile" label="Mobile" hint="We'll text your booking details here." error={errors["customer.mobile"]}>
              <Input id="mobile" value={f.mobile} type="tel" inputMode="tel" autoComplete="tel" className="h-14"
                invalid={!!errors["customer.mobile"]} aria-describedby="mobile-err" onChange={(e) => set("mobile", formatAuMobile(e.target.value))} />
            </Field>
            <Field id="email" label="Email (optional)" error={errors["customer.email"]}>
              <Input id="email" value={f.email} type="email" inputMode="email" autoComplete="email" className="h-14"
                invalid={!!errors["customer.email"]} aria-describedby="email-err" onChange={(e) => set("email", e.target.value)} />
            </Field>
          </div>
        )}

        {step === 4 && (
          <div>
            <label htmlFor="notes" className="sr-only">Anything we should know?</label>
            <textarea id="notes" value={f.notes} maxLength={MAX_NOTES} rows={6}
              placeholder="e.g. a noise when braking, warning light on, best time to call"
              aria-invalid={!!errors.notes || undefined} aria-describedby="notes-err"
              className="w-full rounded-[12px] border border-line bg-white px-4 py-3 text-[17px] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
              onChange={(e) => set("notes", e.target.value)} />
            <div className="mt-1 flex justify-between text-sm text-muted">
              <span id="notes-err" className="text-danger">{errors.notes}</span>
              <span>{f.notes.length}/{MAX_NOTES}</span>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4 text-[15px]">
            <Summary label="Services" onEdit={() => go(0)}>
              <ul>{chosen.map((s) => <li key={s.id}>{s.name} <span className="text-muted">· {formatPrice(s.priceType, s.priceCents)}</span></li>)}</ul>
            </Summary>
            <Summary label="Drop-off" onEdit={() => go(1)}>
              {date && formatDayLong(date)}{win && <>, {formatWindow(win.start, win.end)}</>}
            </Summary>
            <Summary label="Vehicle" onEdit={() => go(2)}>
              <span className="font-mono font-semibold">{payload.vehicle.rego.toUpperCase().replace(/[^A-Z0-9]/g, "")}</span>{" "}
              ({f.state}) · {f.make} {f.model}{f.year && ` · ${f.year}`}
            </Summary>
            <Summary label="Your details" onEdit={() => go(3)}>
              {f.firstName} {f.lastName} · {f.mobile}{f.email && ` · ${f.email}`}
            </Summary>
            {f.notes.trim() && <Summary label="Notes" onEdit={() => go(4)}><span className="whitespace-pre-wrap">{f.notes.trim()}</span></Summary>}
            <p className="text-sm text-muted">{info.priceDisclaimer}</p>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {step < 5 ? (
            <Button size="lg" className="w-full" onClick={next}>Next</Button>
          ) : (
            <>
              <Button size="lg" variant="success" className="w-full" onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                Book
              </Button>
              <Button size="lg" variant="outline" className="w-full" onClick={() => go(0)} disabled={submitting || services.length >= MAX_SERVICES}>
                <Plus aria-hidden="true" /> Add another service
              </Button>
            </>
          )}
        </div>
      </Card>

      {phone && (
        <p className="mt-5 text-center text-sm text-muted">
          Prefer to talk? <a className="font-semibold text-primary" href={telHref(phone)}>Call {phone}</a>
        </p>
      )}
    </Shell>
  );
}

// ---------- pieces ----------
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
      <div className="mb-6 flex justify-center"><Logo /></div>
      {children}
    </main>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block">{label}</Label>
      {hint && <p className="mb-1.5 text-sm text-muted">{hint}</p>}
      {children}
      <FieldError id={`${id}-err`} msg={error} />
    </div>
  );
}

function FieldError({ id, msg }: { id?: string; msg?: string }) {
  return msg ? <p id={id} data-error tabIndex={-1} className="mt-1.5 text-sm font-medium text-danger">{msg}</p> : null;
}

export function DayTile({ day, selected, phone, onPick }: { day: PublicDay; selected: boolean; phone: string | null; onPick: () => void }) {
  const [dow, dd, mon] = formatDay(day.date).split(" ");
  const inner = (label: string) => (
    <>
      <span className="text-xs font-semibold uppercase">{dow}</span>
      <span className="text-[22px] font-bold leading-tight">{dd}</span>
      <span className="text-xs">{mon}</span>
      <span className="mt-0.5 text-[11px] font-semibold">{label}</span>
    </>
  );
  const base = "flex min-h-[88px] w-full flex-col items-center justify-center rounded-[12px] border-2 px-1 py-2 text-center";

  if (day.status === "closed" && day.callUs && phone) {
    // Owner-closed day with "show my number" on (BUSINESS_RULES §1)
    return (
      <a href={telHref(phone)} data-status="call" aria-label={`${formatDayLong(day.date)}: not available online. Call the workshop on ${phone}`}
        className={cn(base, "border-amber-300 bg-amber-50 text-amber-900")}>
        {inner("Call us")}
      </a>
    );
  }
  const open = day.status === "open";
  return (
    <button type="button" data-status={day.status} disabled={!open} aria-pressed={selected} onClick={onPick}
      aria-label={`${formatDayLong(day.date)}${open ? (day.fewLeft ? ", few spots left" : "") : day.status === "full" ? ", full" : ", closed"}`}
      className={cn(base,
        open ? "border-line bg-white text-ink hover:border-primary" : "cursor-not-allowed border-transparent bg-slate-100 text-slate-400",
        selected && "border-primary bg-primary text-white hover:border-primary")}>
      {inner(open ? (day.fewLeft ? "Few left" : "Available") : day.status === "full" ? "Full" : "Closed")}
    </button>
  );
}

function Summary({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
      <div>
        <div className="text-sm font-semibold text-muted">{label}</div>
        <div className="text-ink">{children}</div>
      </div>
      <button type="button" onClick={onEdit} className="min-h-11 px-2 text-sm font-semibold text-primary">Edit</button>
    </div>
  );
}

function Done({ booking, info }: { booking: CreatedBooking; info: PublicInfo }) {
  return (
    <Card className="p-6 text-center sm:p-8">
      <CheckCircle2 className="mx-auto mb-3 h-14 w-14 text-success" aria-hidden="true" />
      <h1 className="text-[24px] font-bold text-ink">You&apos;re booked in</h1>
      <p className="mt-1 font-mono text-lg font-bold">{booking.referenceNo}</p>
      <p className="mt-4 text-[17px]">
        <strong>{formatDayLong(booking.date)}</strong>, drop off {formatWindow(booking.window.start, booking.window.end)}
      </p>
      <p className="mt-2 text-muted">{info.pickupMessage}</p>
      <p className="mt-4 text-sm text-muted">We&apos;ll text you a confirmation with this link too.</p>
      <a href={booking.manageUrl} rel="noreferrer"
        className="mt-3 inline-flex min-h-12 items-center rounded-[12px] border border-line px-5 font-semibold text-primary hover:bg-slate-50">
        Change or cancel
      </a>
      {info.business.address && <p className="mt-4 text-sm text-muted">{info.business.name}, {info.business.address}</p>}
    </Card>
  );
}

function Paused({ phone }: { phone: string | null }) {
  return <Notice title="Online booking is paused right now" phone={phone} />;
}

function Notice({ title, phone }: { title: string; phone: string | null }) {
  return (
    <Card className="p-6 text-center">
      <h1 className="text-[22px] font-bold">{title}</h1>
      {phone ? (
        <a href={telHref(phone)} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-[12px] bg-primary px-5 font-semibold text-white">
          <Phone className="h-5 w-5" aria-hidden="true" /> Call the workshop {phone}
        </a>
      ) : (
        <p className="mt-3 text-muted">Please give the workshop a call to book.</p>
      )}
    </Card>
  );
}
