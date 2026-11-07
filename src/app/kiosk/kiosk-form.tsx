"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Car, CheckCircle2, ClipboardList, KeyRound, Loader2, PauseCircle, PenLine, RotateCcw, Send, ShieldCheck, Timer, User } from "lucide-react";
import { toast } from "sonner";
import { business } from "@config/business";
import { useBrand } from "@/components/brand-provider";
import { SignaturePad, type SignaturePadHandle } from "@/components/kiosk/signature-pad";
import { Logo } from "@/components/logo";
import { PinPad } from "@/components/pin-pad";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { CheckinError, submitCheckin, verifyPin } from "@/lib/data";
import { DEFAULT_CONSENT, DEFAULT_PAUSED_MESSAGE } from "@/lib/settings";
import { JOB_TYPE_LABEL, JOB_TYPES } from "@/lib/types";
import { cn, formatAuPhone } from "@/lib/utils";
import { checkinFormSchema, fieldErrors, LIMITS, maxYear, MIN_YEAR, type CheckinFormValues } from "@/lib/validation";
import { VEHICLE_MAKES } from "@/lib/vehicle-makes";

const STILL_THERE_SECS = 15;

type FieldKey = keyof CheckinFormValues | "signature";
type Errors = Partial<Record<FieldKey, string>>;

const blank = (): CheckinFormValues => ({
  customer_name: "",
  email: "",
  phone: "",
  make: "",
  model: "",
  year: "",
  job_type: "",
  insurance_company: "",
  claim_number: "",
  damage_description: "",
});

// Order used to scroll to the first error
const FIELD_ORDER: FieldKey[] = [
  "customer_name",
  "email",
  "phone",
  "make",
  "model",
  "year",
  "job_type",
  "insurance_company",
  "claim_number",
  "damage_description",
  "signature",
];

const SIGN_MSG = "Please sign in the box";

export default function KioskForm() {
  const router = useRouter();
  const { kiosk: settings, state: settingsState } = useBrand();
  const [fields, setFields] = useState<CheckinFormValues>(blank);
  const [signed, setSigned] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ ref: string; name: string } | null>(null);
  const [countdown, setCountdown] = useState(settings.thank_you_reset_seconds);
  const [stillThere, setStillThere] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [formKey, setFormKey] = useState(0); // remounts the form (and signature pad) on reset
  const lastActivity = useRef<number>(0);
  const sigRef = useRef<SignaturePadHandle>(null);

  const validate = useCallback((f: CheckinFormValues, hasSig: boolean): Errors => {
    const r = checkinFormSchema().safeParse(f);
    const e: Errors = r.success ? {} : fieldErrors(r.error);
    if (!hasSig) e.signature = SIGN_MSG;
    return e;
  }, []);

  const dirty = signed || Object.values(fields).some((v) => v !== "");

  const reset = useCallback(() => {
    setFields(blank());
    setSigned(false);
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
  function set<K extends keyof CheckinFormValues>(key: K, value: CheckinFormValues[K]) {
    setFields((f) => {
      const next = { ...f, [key]: value };
      // Switching away from Insurance clears the insurer and claim number
      if (key === "job_type" && value !== "insurance") {
        next.insurance_company = "";
        next.claim_number = "";
      }
      if (touched[key] || errors[key]) {
        const v = validate(next, signed);
        setErrors((e) => ({ ...e, [key]: v[key] }));
      }
      return next;
    });
  }
  function blur(key: keyof CheckinFormValues) {
    setTouched((t) => ({ ...t, [key]: true }));
    const v = validate(fields, signed);
    setErrors((e) => ({ ...e, [key]: v[key] }));
  }

  function focusFirst(e: Errors) {
    const first = FIELD_ORDER.find((k) => e[k]);
    if (!first) return;
    const el = document.getElementById(first === "job_type" ? "job_type-insurance" : first);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => (el as HTMLElement | null)?.focus({ preventScroll: true }), 350);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const v = validate(fields, signed);
    setErrors(v);
    setTouched(Object.fromEntries(FIELD_ORDER.map((k) => [k, true])));
    if (Object.values(v).some(Boolean)) return focusFirst(v);

    const signature = sigRef.current?.toDataURL();
    if (!signature) {
      setErrors({ signature: SIGN_MSG });
      return focusFirst({ signature: SIGN_MSG });
    }

    setSubmitting(true);
    try {
      const { reference_no } = await submitCheckin(fields, signature);
      setCountdown(settings.thank_you_reset_seconds);
      setDone({ ref: reference_no, name: fields.customer_name.trim().split(/\s+/)[0] });
    } catch (err) {
      setSubmitting(false);
      const serverFields = err instanceof CheckinError ? (err.fields as Errors) : {};
      if (Object.keys(serverFields).length) {
        setErrors(serverFields);
        focusFirst(serverFields);
      }
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
        <Logo className="h-28 sm:h-32" />
        <div className="mt-8 flex h-20 w-20 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 className="h-12 w-12 text-success" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">Thank you, {done.name}!</h1>
        <p className="mt-4 max-w-lg text-lg text-slate-300">{business.kiosk.thankYou}</p>
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
  /** Common props for a text input bound to a form field. */
  const native = (k: keyof CheckinFormValues) => ({
    id: k,
    value: fields[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never),
    onBlur: () => blur(k),
    "aria-invalid": !!err(k) || undefined,
    "aria-describedby": err(k) ? `${k}-error` : undefined,
  });
  /** <Input> also takes `invalid` for its error styling. */
  const bind = (k: keyof CheckinFormValues) => ({ ...native(k), invalid: !!err(k) });
  const insurance = fields.job_type === "insurance";
  const top = maxYear();

  return (
    <div className="min-h-screen bg-page text-[17px]">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 border-b-4 border-primary bg-navy text-white shadow-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="h-14 shrink-0 sm:h-16" />
            <div className="hidden min-w-0 border-l border-white/15 pl-3 sm:block">
              <p className="truncate text-[15px] font-semibold">{business.name}</p>
              <p className="truncate text-sm text-slate-400">Customer Check-in</p>
            </div>
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
        {/* Hero */}
        <section className="overflow-hidden rounded-[20px] bg-gradient-to-br from-primary via-primary-hover to-navy px-7 py-8 text-white shadow-soft sm:px-10 sm:py-10">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">
            <Timer className="h-4 w-4" aria-hidden="true" /> Takes about 2 minutes
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-[40px]">{settings.kiosk_title || business.kiosk.title}</h1>
          <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-white/85">{settings.kiosk_subtitle || business.kiosk.subtitle}</p>
        </section>

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6" key={formKey}>
          {/* 1. Customer */}
          <Section n={1} icon={<User />} title="Your Details" subtitle="How should we contact you about your vehicle?">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="customer_name" label="Full Name" required error={err("customer_name")} className="sm:col-span-2">
                <Input {...bind("customer_name")} autoComplete="name" autoCapitalize="words" maxLength={LIMITS.customer_name} className="h-14 text-[18px]" />
              </Field>
              <Field id="email" label="Email Address" required error={err("email")}>
                <Input
                  {...bind("email")}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="name@example.com"
                  maxLength={LIMITS.email}
                  className="h-14 text-[18px]"
                />
              </Field>
              <Field id="phone" label="Phone" required error={err("phone")} hint="Mobile or landline">
                <Input
                  {...bind("phone")}
                  onChange={(e) => set("phone", formatAuPhone(e.target.value))}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0412 345 678"
                  className="h-14 text-[18px]"
                />
              </Field>
            </div>
          </Section>

          {/* 2. Vehicle */}
          <Section n={2} icon={<Car />} title="Vehicle Details" subtitle="The car you're dropping off">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field id="make" label="Make" required error={err("make")}>
                <Input
                  {...bind("make")}
                  list="make-suggestions"
                  autoCapitalize="words"
                  autoComplete="off"
                  placeholder="e.g. Toyota"
                  maxLength={LIMITS.make}
                  className="h-14 text-[18px]"
                />
                <datalist id="make-suggestions">
                  {VEHICLE_MAKES.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field id="model" label="Model" required error={err("model")}>
                <Input {...bind("model")} autoCapitalize="words" placeholder="e.g. Hilux" maxLength={LIMITS.model} className="h-14 text-[18px]" />
              </Field>
              <Field id="year" label="Year" error={err("year")} hint="Optional">
                <Input
                  {...bind("year")}
                  onChange={(e) => set("year", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  placeholder={`${MIN_YEAR}–${top}`}
                  className="h-14 text-[18px]"
                />
              </Field>
            </div>
          </Section>

          {/* 3. Job */}
          <Section n={3} icon={<ClipboardList />} title="About the Repair" subtitle="All optional – fill in what you know">
            <fieldset aria-describedby={err("job_type") ? "job_type-error" : undefined}>
              <legend className="text-[15px] font-semibold text-ink">Job type</legend>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:max-w-md">
                {JOB_TYPES.map((t) => (
                  <label
                    key={t}
                    htmlFor={`job_type-${t}`}
                    className={cn(
                      "flex min-h-14 cursor-pointer items-center gap-3 rounded-[12px] border-2 bg-white px-4 text-[17px] font-semibold transition-colors",
                      "has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-primary/20",
                      fields.job_type === t ? "border-primary bg-primary/5 text-primary" : "border-line text-ink hover:border-slate-300",
                    )}
                  >
                    <input
                      type="radio"
                      id={`job_type-${t}`}
                      name="job_type"
                      value={t}
                      checked={fields.job_type === t}
                      onChange={() => set("job_type", t)}
                      className="h-5 w-5 accent-[var(--brand-primary)]"
                    />
                    {JOB_TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
              {err("job_type") && (
                <p className="mt-2 text-[15px] font-medium text-danger" id="job_type-error">
                  {err("job_type")}
                </p>
              )}
            </fieldset>

            {/* Insurance details: expand smoothly (grid row 0fr → 1fr), hidden from focus when closed */}
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                insurance ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
              inert={!insurance}
              aria-hidden={!insurance || undefined}
            >
              <div className="overflow-hidden">
                <div className="grid gap-5 pt-5 sm:grid-cols-2">
                  <Field id="insurance_company" label="Insurance company" error={err("insurance_company")}>
                    <Input {...bind("insurance_company")} autoCapitalize="words" placeholder="e.g. NRMA" maxLength={LIMITS.insurance_company} className="h-14 text-[18px]" />
                  </Field>
                  <Field id="claim_number" label="Claim number" error={err("claim_number")}>
                    <Input
                      {...bind("claim_number")}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={LIMITS.claim_number}
                      className="h-14 text-[18px]"
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <Field
                id="damage_description"
                label="Damage description"
                error={err("damage_description")}
                counter={
                  <span
                    className={cn(
                      "text-sm tabular-nums",
                      fields.damage_description.length > LIMITS.damage_description ? "font-semibold text-danger" : "text-muted",
                    )}
                    aria-live="polite"
                  >
                    {fields.damage_description.length}/{LIMITS.damage_description}
                  </span>
                }
              >
                <textarea
                  {...native("damage_description")}
                  rows={4}
                  maxLength={LIMITS.damage_description}
                  placeholder="e.g. Dent in the rear passenger door and scratched bumper"
                  className={cn(
                    "flex min-h-32 w-full rounded-[12px] border border-line bg-white px-4 py-3 text-[18px] text-ink placeholder:text-slate-400",
                    "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15",
                    err("damage_description") && "border-danger bg-red-50/40",
                  )}
                />
              </Field>
            </div>
          </Section>

          {/* 4. Signature */}
          <Section n={4} icon={<PenLine />} title="Signature" subtitle="Please read and sign below">
            <p className="mb-4 flex gap-2.5 rounded-[14px] bg-page p-4 text-[15px] leading-relaxed text-slate-700">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              {settings.consent_text || DEFAULT_CONSENT}
            </p>
            <Label htmlFor="signature" required>
              Your signature
            </Label>
            <div className="mt-2">
              <SignaturePad
                ref={sigRef}
                id="signature"
                invalid={!!err("signature")}
                describedBy={err("signature") ? "signature-error" : undefined}
                onChange={(has) => {
                  setSigned(has);
                  setTouched((t) => ({ ...t, signature: true }));
                  setErrors((e) => ({ ...e, signature: has ? undefined : SIGN_MSG }));
                }}
              />
            </div>
            {err("signature") && (
              <p className="mt-1 text-[15px] font-medium text-danger" id="signature-error">
                {err("signature")}
              </p>
            )}
          </Section>

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
          <Logo className="h-28 sm:h-32" />
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
        description="Everything entered so far, including the signature, will be removed."
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
  children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="scroll-mt-28 p-6 sm:p-8">
      <div className="mb-6 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-primary/10 text-primary [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </span>
        <div>
          <h2 className="text-xl font-bold leading-tight sm:text-2xl">
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
  hint,
  error,
  counter,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  counter?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span>
          <Label htmlFor={id} required={required} className="text-[16px]">
            {label}
          </Label>
          {hint && <span className="ml-1.5 text-sm text-muted">{hint}</span>}
        </span>
        {counter}
      </div>
      {children}
      {error && (
        <p className="text-[15px] font-medium text-danger" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
