"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Car, CheckCircle2, KeyRound, Loader2, PauseCircle, RotateCcw, Send, ShieldCheck, Timer, User } from "lucide-react";
import { toast } from "sonner";
import { useBrand } from "@/components/brand-provider";
import { Logo } from "@/components/logo";
import { MakeSelect } from "@/components/make-select";
import { PinPad } from "@/components/pin-pad";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { submitCheckin, verifyPin } from "@/lib/data";
import { DEFAULT_CONSENT, DEFAULT_PAUSED_MESSAGE } from "@/lib/settings";
import { cn, formatAuMobile, formatKm } from "@/lib/utils";
import { kioskSchema } from "@/lib/validation";
import { findMake } from "@/lib/vehicle-makes";

const STILL_THERE_SECS = 15;

type Fields = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  make: string;
  model: string;
  year: string;
  rego: string;
  colour: string;
  odometer: string; // digits only
};
type FieldKey = keyof Fields;
type Errors = Partial<Record<FieldKey, string>>;

const blank = (): Fields => ({
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  make: "",
  model: "",
  year: String(new Date().getFullYear()),
  rego: "",
  colour: "",
  odometer: "",
});

// Order used to scroll to the first error
const FIELD_ORDER: FieldKey[] = ["first_name", "last_name", "phone", "email", "make", "model", "year", "rego", "colour", "odometer"];

export default function KioskForm() {
  const router = useRouter();
  const { kiosk: settings, state: settingsState } = useBrand();
  const [fields, setFields] = useState<Fields>(blank);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ ref: string; name: string } | null>(null);
  const [countdown, setCountdown] = useState(settings.thank_you_reset_seconds);
  const [stillThere, setStillThere] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [formKey, setFormKey] = useState(0); // remounts the form on reset
  const [makeOther, setMakeOther] = useState(false); // "Other (not listed)" picked: type the make instead
  const lastActivity = useRef<number>(0);

  const schema = kioskSchema(settings);

  const validate = useCallback(
    (f: Fields): Errors => {
      const e: Errors = {};
      const r = schema.safeParse(f);
      if (!r.success) {
        for (const issue of r.error.issues) {
          const k = issue.path[0] as keyof Fields;
          e[k] ??= issue.message;
        }
      }
      return e;
    },
    [schema],
  );

  const dirty = Object.entries(fields).some(([k, v]) => (k === "year" ? v !== String(new Date().getFullYear()) : v !== ""));

  const reset = useCallback(() => {
    setFields(blank());
    setMakeOther(false);
    setErrors({});
    setTouched({});
    setSubmitting(false);
    setDone(null);
    setStillThere(null);
    setConfirmReset(false);
    setFormKey((k) => k + 1);
    lastActivity.current = Date.now();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* ---------- idle timeout → "Still there?" → reset ---------- */
  const idleMs = settings.idle_timeout_minutes * 60_000;
  useEffect(() => {
    lastActivity.current = Date.now();
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "input", "touchstart", "scroll"] as const;
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const t = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle < idleMs) {
        setStillThere(null);
        return;
      }
      const left = Math.ceil((idleMs + STILL_THERE_SECS * 1000 - idle) / 1000);
      if (left <= 0) reset();
      else setStillThere(left);
    }, 1000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      clearInterval(t);
    };
  }, [reset, idleMs]);

  // Only prompt when there's something to lose
  const showStillThere = stillThere !== null && dirty && !done;

  /* ---------- thank-you screen auto-reset ---------- */
  useEffect(() => {
    if (!done) return;
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          reset();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [done, reset]);

  /* ---------- field helpers ---------- */
  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((f) => {
      const next = { ...f, [key]: value };
      if (touched[key] || errors[key]) {
        const v = validate(next);
        setErrors((e) => ({ ...e, [key]: v[key] }));
      }
      return next;
    });
  }
  function blur(key: keyof Fields) {
    setTouched((t) => ({ ...t, [key]: true }));
    const v = validate(fields);
    setErrors((e) => ({ ...e, [key]: v[key] }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const v = validate(fields);
    setErrors(v);
    setTouched(Object.fromEntries(FIELD_ORDER.map((k) => [k, true])));
    const first = FIELD_ORDER.find((k) => v[k]);
    if (first) {
      const el = document.getElementById(first === "make" && makeOther ? "make-other" : first);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => (el as HTMLInputElement | null)?.focus({ preventScroll: true }), 350);
      return;
    }

    setSubmitting(true);
    try {
      const { reference_no } = await submitCheckin({
          first_name: fields.first_name.trim(),
          last_name: fields.last_name.trim(),
          phone: formatAuMobile(fields.phone),
          email: fields.email.trim().toLowerCase() || null,
          make: fields.make.trim(),
          model: fields.model.trim(),
          year: settings.show_year && fields.year ? Number(fields.year) : null,
          rego: fields.rego.trim().toUpperCase(),
          colour: settings.show_colour ? fields.colour.trim() || null : null,
          odometer_km: settings.show_odometer && fields.odometer ? Number(fields.odometer) : null,
      });
      setCountdown(settings.thank_you_reset_seconds);
      setDone({ ref: reference_no, name: fields.first_name.trim() });
    } catch (err) {
      setSubmitting(false);
      toast.error("We couldn't submit your check-in", {
        description: err instanceof Error ? err.message : "Please try again or ask a staff member.",
      });
    }
  }

  async function onStaffPin(pin: string): Promise<string | null> {
    try {
      if (await verifyPin(pin)) {
        router.push("/dashboard");
        return null;
      }
      return "Incorrect PIN";
    } catch (err) {
      return err instanceof Error ? err.message : "Couldn't check the PIN";
    }
  }

  if (settingsState === "loading") {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-navy">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-label="Loading" />
      </main>
    );
  }

  /* ---------- paused (Settings → Kiosk) ---------- */
  const paused = !settings.kiosk_enabled && !done;

  /* ---------- thank-you screen ---------- */
  if (done) {
    return (
      <main className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-navy px-6 py-10 text-center text-white">
        <Logo className="h-20 sm:h-24" />
        <div className="mt-10 flex h-20 w-20 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 className="h-12 w-12 text-success" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">Thank you, {done.name}!</h1>
        <p className="mt-4 max-w-lg text-lg text-slate-300">
          Your vehicle is checked in. Our team has your details and will be in touch about your car.
        </p>
        <div className="mt-8 rounded-[20px] border border-white/10 bg-white/5 px-10 py-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Your reference number</p>
          <p className="mt-2 font-mono text-5xl font-bold tracking-wider" aria-live="polite">
            {done.ref}
          </p>
        </div>
        <p className="mt-8 text-slate-400">Please hand the iPad back to the counter.</p>
        <Button variant="dark" size="lg" className="mt-6" onClick={reset}>
          <RotateCcw /> Start new check-in ({countdown}s)
        </Button>
      </main>
    );
  }

  const err = (k: FieldKey) => (touched[k] ? errors[k] : undefined);

  return (
    <div className="min-h-screen bg-page text-[17px]">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-navy text-white shadow-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="h-12 shrink-0 sm:h-14" />
            <p className="hidden truncate border-l border-white/15 pl-3 text-sm text-slate-400 sm:block">Customer Check-in</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="dark" onClick={() => (dirty ? setConfirmReset(true) : reset())} className="h-12 px-4">
              <RotateCcw /> Reset
            </Button>
            <button
              type="button"
              onClick={() => setStaffOpen(true)}
              className="h-12 rounded-[12px] px-3 text-xs font-medium text-slate-400 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20"
            >
              Staff Portal
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-6">
        {/* Hero (the only gradient in the system) */}
        <section className="overflow-hidden rounded-[20px] bg-gradient-to-br from-[#0B5CFF] via-[#0A4FE0] to-[#0F172A] px-7 py-8 text-white shadow-soft sm:px-10 sm:py-10">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">
            <Timer className="h-4 w-4" aria-hidden="true" /> Quick 1-minute check-in
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-[40px]">{settings.kiosk_title || "Vehicle Check-in Form"}</h1>
          {settings.kiosk_subtitle && <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-blue-100">{settings.kiosk_subtitle}</p>}
        </section>

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6" key={formKey}>
          {/* 1. Customer */}
          <Section n={1} icon={<User />} title="Customer Information" subtitle="Who should we contact about your vehicle?">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="first_name" label="First Name" required error={err("first_name")}>
                <Input
                  id="first_name"
                  autoComplete="given-name"
                  autoCapitalize="words"
                  value={fields.first_name}
                  onChange={(e) => set("first_name", e.target.value)}
                  onBlur={() => blur("first_name")}
                  invalid={!!err("first_name")}
                  aria-describedby={err("first_name") ? "first_name-error" : undefined}
                  className="h-14"
                />
              </Field>
              <Field id="last_name" label="Last Name" required error={err("last_name")}>
                <Input
                  id="last_name"
                  autoComplete="family-name"
                  autoCapitalize="words"
                  value={fields.last_name}
                  onChange={(e) => set("last_name", e.target.value)}
                  onBlur={() => blur("last_name")}
                  invalid={!!err("last_name")}
                  aria-describedby={err("last_name") ? "last_name-error" : undefined}
                  className="h-14"
                />
              </Field>
              <Field id="phone" label="Mobile Phone" required error={err("phone")}>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="04XX XXX XXX"
                  value={fields.phone}
                  onChange={(e) => set("phone", formatAuMobile(e.target.value))}
                  onBlur={() => blur("phone")}
                  invalid={!!err("phone")}
                  aria-describedby={err("phone") ? "phone-error" : undefined}
                  className="h-14"
                />
              </Field>
              <Field id="email" label={settings.email_required ? "Email Address" : "Email Address (optional)"} required={settings.email_required} error={err("email")}>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="name@example.com"
                  value={fields.email}
                  onChange={(e) => set("email", e.target.value)}
                  onBlur={() => blur("email")}
                  invalid={!!err("email")}
                  aria-describedby={err("email") ? "email-error" : undefined}
                  className="h-14"
                />
              </Field>
            </div>
          </Section>

          {/* 2. Vehicle */}
          <Section n={2} icon={<Car />} title="Vehicle Information" subtitle="Details of the car you're dropping off">
            {settings.quick_makes.length > 0 && (
              <div>
                <p className="mb-2.5 text-sm font-semibold text-muted">Quick select make</p>
                <div className="flex flex-wrap gap-2">
                  {settings.quick_makes.map((m) => {
                    const active = fields.make.toLowerCase() === m.toLowerCase();
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          // A chip added in Settings may not be in the list: show it as "Other"
                          const listed = findMake(m);
                          setMakeOther(!listed);
                          set("make", listed ?? m);
                          setErrors((e) => ({ ...e, make: undefined }));
                          document.getElementById("model")?.focus();
                        }}
                        className={cn(
                          "h-12 rounded-full border px-5 text-[16px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25",
                          active ? "border-primary bg-primary text-white" : "border-line bg-white text-ink hover:border-slate-300 hover:bg-slate-50",
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={cn("grid gap-5 sm:grid-cols-3", settings.quick_makes.length > 0 && "mt-6")}>
              <Field id="make" label="Vehicle Make" required error={makeOther && err("make") && !fields.make.trim() ? "Please type the vehicle make" : err("make")}>
                <MakeSelect
                  id="make"
                  value={fields.make}
                  other={makeOther}
                  popular={settings.quick_makes}
                  onPick={(v, other) => {
                    setMakeOther(other);
                    set("make", v);
                    if (v) setErrors((x) => ({ ...x, make: undefined }));
                  }}
                  onType={(v) => set("make", v)}
                  onBlur={() => blur("make")}
                  invalid={!!err("make")}
                  describedBy={err("make") ? "make-error" : undefined}
                />
              </Field>
              <Field id="model" label="Vehicle Model" required error={err("model")}>
                <Input
                  id="model"
                  autoCapitalize="words"
                  placeholder="e.g. Hilux"
                  value={fields.model}
                  onChange={(e) => set("model", e.target.value)}
                  onBlur={() => blur("model")}
                  invalid={!!err("model")}
                  aria-describedby={err("model") ? "model-error" : undefined}
                  className="h-14"
                />
              </Field>
              {settings.show_year && (
                <Field id="year" label="Year" error={err("year")}>
                  <Input
                    id="year"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    value={fields.year}
                    onChange={(e) => set("year", e.target.value.replace(/\D/g, "").slice(0, 4))}
                    onBlur={() => blur("year")}
                    invalid={!!err("year")}
                    aria-describedby={err("year") ? "year-error" : undefined}
                    className="h-14"
                  />
                </Field>
              )}
              <Field id="rego" label="Registration (Rego)" required error={err("rego")}>
                <Input
                  id="rego"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="ABC12D"
                  maxLength={7}
                  value={fields.rego}
                  onChange={(e) => set("rego", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7))}
                  onBlur={() => blur("rego")}
                  invalid={!!err("rego")}
                  aria-describedby={err("rego") ? "rego-error" : undefined}
                  className="h-14 font-mono text-[19px] font-bold tracking-[0.15em] placeholder:font-normal placeholder:tracking-[0.15em]"
                />
              </Field>
              {settings.show_colour && (
                <Field id="colour" label="Colour" error={err("colour")}>
                  <Input
                    id="colour"
                    autoCapitalize="words"
                    placeholder="e.g. White"
                    maxLength={40}
                    value={fields.colour}
                    onChange={(e) => set("colour", e.target.value)}
                    className="h-14"
                  />
                </Field>
              )}
              {settings.show_odometer && (
                <Field id="odometer" label="Odometer (km)" error={err("odometer")}>
                  <div className="relative">
                    <Input
                      id="odometer"
                      inputMode="numeric"
                      pattern="[0-9,]*"
                      placeholder="e.g. 85,000"
                      value={fields.odometer ? formatKm(Number(fields.odometer)) : ""}
                      onChange={(e) => set("odometer", e.target.value.replace(/\D/g, "").slice(0, 7))}
                      className="h-14 pr-12"
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] font-medium text-muted">km</span>
                  </div>
                </Field>
              )}
            </div>
          </Section>

          {/* Authorisation (no signature needed) */}
          <p className="flex gap-2.5 rounded-[16px] border border-line bg-white p-5 text-[15px] leading-relaxed text-slate-600 shadow-soft">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            {settings.consent_text || DEFAULT_CONSENT}
          </p>

          <Button type="submit" size="xl" className="h-16 w-full text-[19px] shadow-lg shadow-primary/20" disabled={submitting}>
            {submitting ? <Loader2 className="!size-6 animate-spin" /> : <Send className="!size-5" />}
            {submitting ? "Submitting…" : "Submit Check-in"}
          </Button>
          <p className="text-center text-sm text-muted">
            Fields marked <span className="text-danger">*</span> are required.
          </p>
        </form>
      </main>

      {/* Paused by the owner (Settings → Kiosk) */}
      {paused && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-navy px-6 text-center text-white" role="alert">
          <Logo className="h-20 sm:h-24" />
          <PauseCircle className="mt-10 h-16 w-16 text-plate" aria-hidden="true" />
          <p className="mt-6 max-w-xl text-3xl font-bold leading-snug">{settings.kiosk_paused_message || DEFAULT_PAUSED_MESSAGE}</p>
          <button
            type="button"
            onClick={() => setStaffOpen(true)}
            className="absolute bottom-6 right-6 h-12 rounded-[12px] px-3 text-xs font-medium text-slate-500 hover:text-slate-300"
          >
            Staff Portal
          </button>
        </div>
      )}

      {/* Still there? */}
      <Modal
        open={showStillThere}
        onOpenChange={() => {
          lastActivity.current = Date.now();
          setStillThere(null);
        }}
        icon={<Timer className="text-warning" />}
        title="Are you still there?"
        description={
          <>
            For privacy, this form will clear in <span className="font-bold text-ink">{stillThere}s</span>.
          </>
        }
      >
        <Button
          size="lg"
          className="mt-6 w-full"
          onClick={() => {
            lastActivity.current = Date.now();
            setStillThere(null);
          }}
        >
          I&apos;m still here
        </Button>
      </Modal>

      {/* Reset confirmation */}
      <Modal
        open={confirmReset}
        onOpenChange={setConfirmReset}
        icon={<RotateCcw className="text-danger" />}
        title="Clear this form?"
        description="Everything entered so far will be removed."
      >
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={() => setConfirmReset(false)}>
            Keep editing
          </Button>
          <Button variant="destructive" size="lg" onClick={reset}>
            Clear form
          </Button>
        </div>
      </Modal>

      {/* Staff access requires the owner PIN */}
      <Modal
        open={staffOpen}
        onOpenChange={setStaffOpen}
        icon={<KeyRound className="text-primary" />}
        title="Staff access"
        description={settings.pin_set ? "Enter the owner PIN to leave the kiosk." : "No PIN has been set yet. Staff can sign in with the owner password."}
      >
        {staffOpen &&
          (settings.pin_set ? (
            <div className="mt-6">
              <PinPad onSubmit={onStaffPin} />
            </div>
          ) : (
            <Button size="lg" className="mt-6 w-full" onClick={() => router.push("/login?next=/dashboard")}>
              Go to staff login
            </Button>
          ))}
        <Button variant="ghost" className="mt-3 w-full" onClick={() => setStaffOpen(false)}>
          Cancel
        </Button>
      </Modal>
    </div>
  );
}

/* ---------- small layout helpers ---------- */

function Section({
  n,
  icon,
  title,
  subtitle,
  id,
  children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-28 p-6 sm:p-8">
      <div className="mb-6 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-blue-50 text-primary [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </span>
        <div>
          <h2 className="text-xl font-bold leading-tight">
            <span className="text-primary">{n}.</span> {title}
          </h2>
          <p className="mt-1 text-[15px] text-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-[14px] font-medium text-danger" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
