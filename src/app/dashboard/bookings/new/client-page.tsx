"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Car, Check, Loader2, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard/header";
import { MakeSelect } from "@/components/make-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDay, formatPrice, formatWindow } from "@/lib/booking/format";
import { addDays, sydneyNow } from "@/lib/booking/owner";
import {
  availabilityRange, customerLookup, listActiveServices, listWindows, ownerCreateBooking,
  type CustomerLookup, type DayAvailability,
} from "@/lib/booking/owner-data";
import { MAX_NOTES, MAX_SERVICES, PublicCreateBooking, REGO_STATES, normaliseMobile, toDbInput } from "@/lib/booking/schemas";
import { findMake } from "@/lib/vehicle-makes";
import { cn } from "@/lib/utils";

const DAYS_SHOWN = 21;

type Fields = {
  mobile: string; firstName: string; lastName: string; email: string;
  rego: string; state: string; make: string; makeOther: boolean; model: string; year: string; notes: string;
};
const blank: Fields = {
  mobile: "", firstName: "", lastName: "", email: "",
  rego: "", state: "NSW", make: "", makeOther: false, model: "", year: "", notes: "",
};

type Lookup = { state: "idle" | "loading" | "done"; mobile: string | null; result: CustomerLookup | null };

export default function QuickAddPage() {
  const router = useRouter();
  const today = sydneyNow().date;
  const [f, setF] = useState<Fields>(blank);
  const [services, setServices] = useState<Awaited<ReturnType<typeof listActiveServices>>>([]);
  const [windows, setWindows] = useState<Awaited<ReturnType<typeof listWindows>>>([]);
  const [days, setDays] = useState<DayAvailability[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [otherDay, setOtherDay] = useState<DayAvailability | null>(null);
  const [windowId, setWindowId] = useState("");
  const [over, setOver] = useState(false);
  const [sendSms, setSendSms] = useState(true);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle", mobile: null, result: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((x) => ({ ...x, [k]: v }));

  // Services, windows and the next three weeks
  useEffect(() => {
    let cancelled = false;
    Promise.all([listActiveServices(), listWindows(), availabilityRange(today, addDays(today, DAYS_SHOWN - 1))])
      .then(([s, w, d]) => {
        if (cancelled) return;
        setServices(s);
        setWindows(w);
        setWindowId((cur) => cur || w[0]?.id || "");
        setDays(d);
      })
      .catch((e) => toast.error("Couldn't load the booking form", { description: e instanceof Error ? e.message : undefined }));
    return () => {
      cancelled = true;
    };
  }, [today]);

  // Look the customer up as soon as the mobile is complete
  const mobile = normaliseMobile(f.mobile);
  useEffect(() => {
    if (!mobile || lookup.mobile === mobile) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLookup({ state: "loading", mobile, result: null });
      customerLookup(mobile)
        .then((result) => {
          if (cancelled) return;
          setLookup({ state: "done", mobile, result });
          if (!result) return;
          setF((x) => ({
            ...x,
            firstName: x.firstName || result.firstName,
            lastName: x.lastName || result.lastName,
            email: x.email || result.email || "",
          }));
          if (result.vehicles.length === 1) pickVehicle(result.vehicles[0]);
        })
        .catch(() => !cancelled && setLookup({ state: "done", mobile, result: null }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per new complete mobile
  }, [mobile]);

  function pickVehicle(v: CustomerLookup["vehicles"][number]) {
    const listed = findMake(v.make);
    setF((x) => ({
      ...x,
      rego: v.rego,
      state: v.state ?? x.state,
      make: listed ?? v.make,
      makeOther: !listed,
      model: v.model,
      year: v.year ? String(v.year) : "",
    }));
  }

  // A date from the picker beyond the strip: fetch its availability
  const inStrip = days.some((d) => d.day === date);
  useEffect(() => {
    if (!date || inStrip) return;
    let cancelled = false;
    availabilityRange(date, date)
      .then(([d]) => !cancelled && setOtherDay(d ?? null))
      .catch(() => !cancelled && setOtherDay(null));
    return () => {
      cancelled = true;
    };
  }, [date, inStrip]);

  const day = inStrip ? days.find((d) => d.day === date) ?? null : otherDay?.day === date ? otherDay : null;
  const full = day?.status === "full";
  const closed = day?.status === "closed";

  const payload = useMemo(
    () => ({
      serviceIds: picked,
      date,
      windowId,
      customer: { firstName: f.firstName, lastName: f.lastName, mobile: f.mobile, email: f.email },
      vehicle: { rego: f.rego, state: f.state, make: f.make, model: f.model, year: f.year },
      notes: f.notes,
    }),
    [picked, date, windowId, f],
  );

  async function save() {
    setBanner(null);
    const r = PublicCreateBooking.safeParse(payload);
    const e: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) e[i.path.join(".")] ??= i.message;
    if (!date) e.date = "Choose a day";
    else if (closed) e.date = "The workshop is closed that day";
    else if (full && !over) e.date = "That day is full: tick Overbook to book it anyway";
    setErrors(e);
    if (!r.success || Object.keys(e).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-error]")?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    setSaving(true);
    try {
      const b = await ownerCreateBooking(toDbInput(r.data), full && over, sendSms);
      toast.success(`Booked ${b.reference_no} for ${formatDay(date)}`);
      router.push(`/dashboard/bookings/${b.id}`);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader back={{ href: "/dashboard/bookings", label: "Bookings" }} />
      <main className="mx-auto max-w-2xl px-4 pb-32 pt-6 sm:px-6">
        <h1 className="text-2xl font-bold">New booking</h1>
        <p className="text-muted">For a customer on the phone. Start with their mobile.</p>

        <Section title="Customer">
          <Field id="mobile" label="Mobile" error={errors["customer.mobile"]}>
            <Input id="mobile" type="tel" inputMode="tel" autoComplete="off" value={f.mobile} className="h-14 text-lg"
              placeholder="0412 345 678" invalid={!!errors["customer.mobile"]} onChange={(e) => set("mobile", e.target.value)} />
          </Field>
          {mobile && lookup.mobile === mobile && (
            <div role="status" className="text-sm">
              {lookup.state === "loading" ? (
                <p className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Looking up…</p>
              ) : lookup.result ? (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 font-semibold text-emerald-700">
                    <UserCheck className="h-4 w-4" aria-hidden="true" /> Returning customer: details filled in
                  </p>
                  {lookup.result.noShows > 0 && (
                    <p className="flex items-center gap-2 font-semibold text-red-700">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      {lookup.result.noShows === 1 ? "1 earlier no-show" : `${lookup.result.noShows} earlier no-shows`}
                    </p>
                  )}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-muted"><UserPlus className="h-4 w-4" aria-hidden="true" /> New customer</p>
              )}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="firstName" label="First name" error={errors["customer.firstName"]}>
              <Input id="firstName" value={f.firstName} maxLength={80} autoCapitalize="words" className="h-12"
                invalid={!!errors["customer.firstName"]} onChange={(e) => set("firstName", e.target.value)} />
            </Field>
            <Field id="lastName" label="Last name" error={errors["customer.lastName"]}>
              <Input id="lastName" value={f.lastName} maxLength={80} autoCapitalize="words" className="h-12"
                invalid={!!errors["customer.lastName"]} onChange={(e) => set("lastName", e.target.value)} />
            </Field>
          </div>
          <Field id="email" label="Email (optional)" error={errors["customer.email"]}>
            <Input id="email" type="email" inputMode="email" autoCapitalize="none" value={f.email} className="h-12"
              invalid={!!errors["customer.email"]} onChange={(e) => set("email", e.target.value)} />
          </Field>
        </Section>

        <Section title="Vehicle">
          {lookup.result && lookup.mobile === mobile && lookup.result.vehicles.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Their cars">
              {lookup.result.vehicles.map((v) => (
                <button key={v.rego} type="button" onClick={() => pickVehicle(v)} aria-pressed={f.rego === v.rego}
                  className={cn("inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold",
                    f.rego === v.rego ? "border-navy bg-navy text-white" : "border-line bg-white hover:bg-slate-50")}>
                  <Car className="h-4 w-4" aria-hidden="true" /> <span className="font-mono">{v.rego}</span> {v.make} {v.model}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field id="rego" label="Rego" error={errors["vehicle.rego"]}>
              <Input id="rego" value={f.rego} maxLength={12} autoCapitalize="characters" className="h-12 font-mono uppercase"
                invalid={!!errors["vehicle.rego"]} onChange={(e) => set("rego", e.target.value)} />
            </Field>
            <Field id="state" label="State" error={errors["vehicle.state"]}>
              <select id="state" value={f.state} onChange={(e) => set("state", e.target.value)}
                className="h-12 rounded-[12px] border border-line bg-white px-3 text-[16px]">
                {REGO_STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field id="make" label="Make" error={errors["vehicle.make"]}>
            <MakeSelect id="make" value={f.make} other={f.makeOther} invalid={!!errors["vehicle.make"]}
              onPick={(v, other) => setF((x) => ({ ...x, make: v, makeOther: other }))} onType={(v) => set("make", v)} />
          </Field>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field id="model" label="Model" error={errors["vehicle.model"]}>
              <Input id="model" value={f.model} maxLength={80} className="h-12" invalid={!!errors["vehicle.model"]}
                onChange={(e) => set("model", e.target.value)} />
            </Field>
            <Field id="year" label="Year" error={errors["vehicle.year"]}>
              <Input id="year" value={f.year} inputMode="numeric" maxLength={4} className="h-12" invalid={!!errors["vehicle.year"]}
                onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
        </Section>

        <Section title="Services">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Services">
            {services.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button key={s.id} type="button" aria-pressed={on}
                  disabled={!on && picked.length >= MAX_SERVICES}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                  className={cn("inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-left text-sm font-semibold disabled:opacity-50",
                    on ? "border-primary bg-primary text-white" : "border-line bg-white hover:bg-slate-50")}>
                  {on && <Check className="h-4 w-4" aria-hidden="true" />}
                  {s.name}
                  <span className={cn("font-normal", on ? "text-blue-100" : "text-muted")}>{formatPrice(s.price_type, s.price_cents)}</span>
                </button>
              );
            })}
          </div>
          <FieldError msg={errors.serviceIds} />
        </Section>

        <Section title="Drop-off day">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Next three weeks">
            {days.map((d) => {
              const [dow, dd, mon] = formatDay(d.day).split(" ");
              const isClosed = d.status === "closed";
              return (
                <button key={d.day} type="button" disabled={isClosed} aria-pressed={date === d.day}
                  aria-label={`${formatDay(d.day)}: ${isClosed ? "closed" : d.status === "full" ? "full" : `${d.spots_left} left`}`}
                  onClick={() => { setDate(d.day); setOver(false); }}
                  className={cn("flex w-[72px] shrink-0 flex-col items-center rounded-[12px] border-2 py-2 text-center",
                    date === d.day ? "border-primary bg-blue-50" : "border-line bg-white",
                    isClosed && "opacity-40")}>
                  <span className="text-xs font-semibold uppercase">{d.day === today ? "Today" : dow}</span>
                  <span className="text-xl font-bold leading-tight">{dd}</span>
                  <span className="text-xs">{mon}</span>
                  <span className={cn("mt-0.5 text-[11px] font-semibold", d.status === "full" ? "text-red-700" : "text-muted")}>
                    {isClosed ? "Closed" : d.status === "full" ? "Full" : `${d.spots_left} left`}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-3 text-sm font-semibold">
            Other date
            <input type="date" min={today} value={inStrip ? "" : date} onChange={(e) => { setDate(e.target.value); setOver(false); }}
              className="h-11 rounded-[12px] border border-line bg-white px-3 text-[16px]" />
          </label>
          {date && day && (
            <p role="status" className={cn("rounded-[12px] px-3 py-2 text-sm font-semibold", closed || full ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800")}>
              {formatDay(date)}:{" "}
              {closed ? (day.reason === "past" ? "that day has passed" : `closed${day.note ? ` (${day.note})` : ""}`)
                : full ? `full, ${day.booked} of ${day.capacity} booked` : `${day.spots_left} of ${day.capacity} spots left`}
            </p>
          )}
          {full && (
            <label className="flex items-start gap-3 rounded-[12px] border border-line bg-white p-3 text-[15px]">
              <input type="checkbox" className="mt-0.5 h-5 w-5" checked={over} onChange={(e) => setOver(e.target.checked)} />
              Overbook: take this car anyway
            </label>
          )}
          <FieldError msg={errors.date} />
          {windows.length > 1 && (
            <Field id="window" label="Drop-off time" error={errors.windowId}>
              <select id="window" value={windowId} onChange={(e) => setWindowId(e.target.value)}
                className="h-12 w-full rounded-[12px] border border-line bg-white px-3 text-[16px]">
                {windows.map((w) => <option key={w.id} value={w.id}>{formatWindow(w.start_time, w.end_time)}</option>)}
              </select>
            </Field>
          )}
        </Section>

        <Section title="Notes">
          <Field id="notes" label="What the customer said (optional)" error={errors.notes}>
            <textarea id="notes" value={f.notes} maxLength={MAX_NOTES} rows={3} onChange={(e) => set("notes", e.target.value)}
              className="w-full rounded-[12px] border border-line bg-white px-4 py-3 text-[16px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15" />
          </Field>
          <label className="flex items-start gap-3 rounded-[12px] border border-line bg-white p-3 text-[15px]">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} />
            Text the customer a confirmation
          </label>
        </Section>

        {banner && <p role="alert" className="mt-5 rounded-[12px] bg-red-50 px-4 py-3 font-medium text-red-700">{banner}</p>}
      </main>

      {/* Save stays in reach of the thumb */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 p-3 backdrop-blur lg:left-60">
        <div className="mx-auto max-w-2xl">
          <Button size="lg" className="w-full" disabled={saving} onClick={save}>
            {saving && <Loader2 className="animate-spin" />} Save booking
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 space-y-4 rounded-[20px] border border-line bg-white p-5 shadow-soft">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block">{label}</Label>
      {children}
      <FieldError msg={error} />
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p data-error className="mt-1.5 text-sm font-medium text-danger">{msg}</p> : null;
}
