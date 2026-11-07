"use client";

// Settings → Online Booking (TASKS T8; BUSINESS_RULES §1, §5, §9, §10). The owner edits the
// booking_* settings tables directly (RLS + column grants); the DB checks every value again.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Plus, Save, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { FormField, SaveFooter, selectClass, SettingsCard, textareaClass, ToggleRow } from "@/components/settings/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { sydneyToday } from "@/lib/booking/dates";
import { formatDayLong, formatPrice, formatWindow } from "@/lib/booking/format";
import {
  fieldErrors, GeneralSettings, hhmm, OverrideForm, SENDER_ID_HINT, ServiceForm, WeeklyHoursRow, WindowForm,
} from "@/lib/booking/settings";
import {
  bookingsOnDate, deleteOverride, deleteWindow, loadBookingSettings, saveBookingSettings, saveOverride, saveService,
  saveWeeklyHours, saveWindow, type BookingSettingsRow, type DayBooking, type OverrideDbRow, type ServiceRow, type WeeklyRow,
  type WindowRow,
} from "@/lib/booking/settings-data";
import { cn } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof loadBookingSettings>>;
const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Couldn't save. Please try again.");

export function BookingTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dirtyParts, setDirtyParts] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    try {
      setData(await loadBookingSettings());
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    let live = true;
    loadBookingSettings().then((d) => live && setData(d)).catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, []);

  const markDirty = useCallback((part: string, d: boolean) => setDirtyParts((p) => (p[part] === d ? p : { ...p, [part]: d })), []);
  const anyDirty = Object.values(dirtyParts).some(Boolean);
  useEffect(() => onDirty(anyDirty), [anyDirty, onDirty]);

  if (loadError) return <p className="rounded-[12px] bg-red-50 p-4 text-danger">Couldn&apos;t load the booking settings. Please refresh.</p>;
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GeneralCards initial={data.settings} onDirty={(d) => markDirty("general", d)} />
      <HoursCard initial={data.hours} onDirty={(d) => markDirty("hours", d)} onSaved={reload} />
      <DatesCard overrides={data.overrides} hours={data.hours} onChanged={reload} />
      <ServicesCard services={data.services} onChanged={reload} />
      <WindowsCard windows={data.windows} onChanged={reload} />
    </div>
  );
}

// ---------------------------------------------------------------- general + SMS
type GeneralDraft = Omit<BookingSettingsRow, "horizon_days" | "max_active_per_mobile"> & { horizon_days: string; max_active_per_mobile: string };
const toDraft = (s: BookingSettingsRow): GeneralDraft => ({
  ...s,
  horizon_days: String(s.horizon_days),
  max_active_per_mobile: String(s.max_active_per_mobile),
  online_cutoff_time: hhmm(s.online_cutoff_time),
  cancel_cutoff_time: hhmm(s.cancel_cutoff_time),
  reminder_time: hhmm(s.reminder_time),
});

function GeneralCards({ initial, onDirty }: { initial: BookingSettingsRow; onDirty: (d: boolean) => void }) {
  const [saved, setSaved] = useState(() => toDraft(initial));
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = !same(draft, saved);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const set = <K extends keyof GeneralDraft>(k: K, v: GeneralDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    const r = GeneralSettings.safeParse(draft);
    if (!r.success) {
      setErrors(fieldErrors(r.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const next = toDraft(await saveBookingSettings(r.data));
      setSaved(next);
      setDraft(next);
      toast.success("Online booking settings saved");
    } catch (e) {
      toast.error("Couldn't save", { description: errMsg(e) });
    } finally {
      setSaving(false);
    }
  }
  const footer = <SaveFooter dirty={dirty} saving={saving} onSave={save} onDiscard={() => { setDraft(saved); setErrors({}); }} />;

  return (
    <>
      <SettingsCard
        title="Online booking"
        description={
          <>
            Customers book at{" "}
            <Link href="/book" target="_blank" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              /book <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            . Changes apply straight away.
          </>
        }
        footer={footer}
      >
        <div className="divide-y divide-line">
          <ToggleRow id="bk-online" label="Take bookings online"
            description="Turn off to pause /book (customers see your phone number). Existing bookings and their links keep working."
            checked={draft.online_enabled} onCheckedChange={(v) => set("online_enabled", v)} />
        </div>
        <div className="mt-2 grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
          <FormField id="bk-horizon" label="How far ahead (days)" error={errors.horizon_days}>
            <Input id="bk-horizon" inputMode="numeric" value={draft.horizon_days} invalid={!!errors.horizon_days}
              onChange={(e) => set("horizon_days", e.target.value.replace(/\D/g, ""))} />
          </FormField>
          <FormField id="bk-max" label="Bookings per mobile (at once)" hint="Stops one number booking lots of days." error={errors.max_active_per_mobile}>
            <Input id="bk-max" inputMode="numeric" value={draft.max_active_per_mobile} invalid={!!errors.max_active_per_mobile}
              onChange={(e) => set("max_active_per_mobile", e.target.value.replace(/\D/g, ""))} />
          </FormField>
          <FormField id="bk-cutoff" label="Booking for tomorrow closes at" hint="Same-day bookings are never taken online." error={errors.online_cutoff_time}>
            <Input id="bk-cutoff" type="time" value={draft.online_cutoff_time} onChange={(e) => set("online_cutoff_time", e.target.value)} />
          </FormField>
          <FormField id="bk-cancel" label="Customers can change or cancel until" hint="On the day before drop-off. After that they're asked to call." error={errors.cancel_cutoff_time}>
            <Input id="bk-cancel" type="time" value={draft.cancel_cutoff_time} onChange={(e) => set("cancel_cutoff_time", e.target.value)} />
          </FormField>
          <FormField id="bk-pickup" label="Pick-up message" hint="Shown after the drop-off time." error={errors.pickup_message} className="sm:col-span-2">
            <Input id="bk-pickup" value={draft.pickup_message} maxLength={200} onChange={(e) => set("pickup_message", e.target.value)} />
          </FormField>
          <FormField id="bk-disclaimer" label="Price note" hint="Shown under the services." error={errors.price_disclaimer} className="sm:col-span-2">
            <textarea id="bk-disclaimer" className={textareaClass} maxLength={300} value={draft.price_disclaimer}
              onChange={(e) => set("price_disclaimer", e.target.value)} />
          </FormField>
        </div>
      </SettingsCard>

      <SettingsCard title="Text messages" description="Confirmation, reminder, change and ready texts." footer={footer}>
        <div className="divide-y divide-line">
          <ToggleRow id="bk-sms" label="Send texts" description="Off: nothing is sent; queued texts are dropped."
            checked={draft.sms_enabled} onCheckedChange={(v) => set("sms_enabled", v)} />
        </div>
        <div className="mt-2 grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
          <FormField id="bk-sender" label="Sender name" hint={SENDER_ID_HINT} error={errors.sms_sender_id}>
            <Input id="bk-sender" value={draft.sms_sender_id} maxLength={20} invalid={!!errors.sms_sender_id}
              onChange={(e) => set("sms_sender_id", e.target.value)} />
          </FormField>
          <FormField id="bk-reminder" label="Reminder time (day before)" error={errors.reminder_time}>
            <Input id="bk-reminder" type="time" value={draft.reminder_time} onChange={(e) => set("reminder_time", e.target.value)} />
          </FormField>
          <FormField id="bk-ready" label="Ready-for-pickup text" className="sm:col-span-2">
            <select id="bk-ready" className={selectClass} value={draft.ready_sms_mode}
              onChange={(e) => set("ready_sms_mode", e.target.value as GeneralDraft["ready_sms_mode"])}>
              <option value="manual">Only when I press Send ready SMS</option>
              <option value="on_complete">Also automatically when a booked car&apos;s job is Completed</option>
            </select>
          </FormField>
        </div>
      </SettingsCard>
    </>
  );
}

// ---------------------------------------------------------------- weekly hours
type HoursDraft = { weekday: number; is_open: boolean; open_time: string; close_time: string; capacity_cars: string };
const hoursDraft = (rows: WeeklyRow[]): HoursDraft[] =>
  rows.map((r) => ({ ...r, open_time: hhmm(r.open_time), close_time: hhmm(r.close_time), capacity_cars: String(r.capacity_cars) }));

function HoursCard({ initial, onDirty, onSaved }: { initial: WeeklyRow[]; onDirty: (d: boolean) => void; onSaved: () => void }) {
  const saved = useMemo(() => hoursDraft(initial), [initial]);
  const [draft, setDraft] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = !same(draft, saved);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const set = (i: number, patch: Partial<HoursDraft>) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    const errs: Record<string, string> = {};
    const rows: WeeklyRow[] = [];
    draft.forEach((r) => {
      const p = WeeklyHoursRow.safeParse(r);
      if (!p.success) for (const [k, m] of Object.entries(fieldErrors(p.error))) errs[`${r.weekday}.${k}`] = m;
      else rows.push(p.data);
    });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await saveWeeklyHours(rows.filter((r, i) => !same(draft[i], saved[i])));
      toast.success("Weekly hours saved");
      onSaved();
    } catch (e) {
      toast.error("Couldn't save", { description: errMsg(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard title="Weekly hours" description="Which days you take cars, and how many cars per day."
      footer={<SaveFooter dirty={dirty} saving={saving} onSave={save} onDiscard={() => { setDraft(saved); setErrors({}); }} />}>
      <ul className="divide-y divide-line">
        {draft.map((r, i) => {
          const e = (k: string) => errors[`${r.weekday}.${k}`];
          return (
            <li key={r.weekday} role="group" aria-label={DAY_NAMES[r.weekday]} className="py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <span className="w-24 font-semibold">{DAY_NAMES[r.weekday]}</span>
                <span className="flex items-center gap-2 text-sm text-muted">
                  <Switch aria-label="Open" checked={r.is_open} onCheckedChange={(v) => set(i, { is_open: v })} />
                  {r.is_open ? "Open" : "Closed"}
                </span>
                {r.is_open && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input aria-label="Opens" type="time" className="h-11 w-32" value={r.open_time} onChange={(ev) => set(i, { open_time: ev.target.value })} />
                    <span className="text-muted">to</span>
                    <Input aria-label="Closes" type="time" className="h-11 w-32" invalid={!!e("close_time")} value={r.close_time}
                      onChange={(ev) => set(i, { close_time: ev.target.value })} />
                    <label className="ml-2 flex items-center gap-2 text-sm font-semibold">
                      Cars
                      <Input inputMode="numeric" className="h-11 w-20" invalid={!!e("capacity_cars")} value={r.capacity_cars}
                        onChange={(ev) => set(i, { capacity_cars: ev.target.value.replace(/\D/g, "") })} />
                    </label>
                  </div>
                )}
              </div>
              {(e("close_time") || e("capacity_cars")) && (
                <p role="alert" className="mt-2 text-sm font-medium text-danger">{e("capacity_cars") ?? e("close_time")}</p>
              )}
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------- closed and special dates
const blankOverride = { date: "", is_open: false, open_time: "", close_time: "", capacity_cars: "", reason: "", show_phone: false };

function DatesCard({ overrides, hours, onChanged }: { overrides: OverrideDbRow[]; hours: WeeklyRow[]; onChanged: () => void }) {
  const today = sydneyToday();
  const upcoming = overrides.filter((o) => o.date >= today);
  const [form, setForm] = useState(blankOverride);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<{ row: OverrideDbRow; bookings: DayBooking[] } | null>(null);
  const set = (patch: Partial<typeof blankOverride>) => {
    setForm((f) => ({ ...f, ...patch }));
    setWarning(null);
  };

  async function write(row: OverrideDbRow) {
    setBusy(true);
    try {
      await saveOverride(row);
      toast.success(row.is_open ? "Special opening saved" : "Closed date saved");
      setForm(blankOverride);
      setWarning(null);
      onChanged();
    } catch (e) {
      toast.error("Couldn't save", { description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const p = OverrideForm.safeParse(form);
    if (!p.success) return setErrors(fieldErrors(p.error));
    setErrors({});
    const row = p.data as OverrideDbRow;
    // Closing a day (or cutting its capacity) that already has bookings: list them first
    setBusy(true);
    let onDay: DayBooking[] = [];
    try {
      onDay = await bookingsOnDate(row.date);
    } catch (e) {
      setBusy(false);
      return toast.error(errMsg(e));
    }
    setBusy(false);
    if (onDay.length && (!row.is_open || (row.capacity_cars ?? 0) < onDay.length)) return setWarning({ row, bookings: onDay });
    await write(row);
  }

  async function remove(date: string) {
    try {
      await deleteOverride(date);
      toast.success("Date removed");
      onChanged();
    } catch (e) {
      toast.error("Couldn't remove", { description: errMsg(e) });
    }
  }

  const weekday = form.date ? hours.find((h) => h.weekday === ((new Date(`${form.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) : undefined;

  return (
    <SettingsCard title="Closed and special dates"
      description="Close a day (holiday, training) or open one you're normally closed. Public holidays are closed automatically.">
      {upcoming.length > 0 ? (
        <ul className="divide-y divide-line rounded-[12px] border border-line" aria-label="Upcoming dates">
          {upcoming.map((o) => (
            <li key={o.date} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">{formatDayLong(o.date)} {o.date.slice(0, 4)}</p>
                <p className="text-sm text-muted">
                  {o.is_open
                    ? `Open${o.open_time && o.close_time ? ` ${formatWindow(o.open_time, o.close_time)}` : ""} · ${o.capacity_cars} cars`
                    : `Closed${o.show_phone ? " · customers see your number" : ""}`}
                  {o.reason ? ` · ${o.reason}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" aria-label={`Remove ${formatDayLong(o.date)}`} onClick={() => remove(o.date)}>
                <X /> Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No closed or special dates coming up.</p>
      )}

      <div className="mt-6 border-t border-line pt-6">
        <p className="font-semibold">Add a date</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <FormField id="ov-date" label="Date" error={errors.date}>
            <Input id="ov-date" type="date" min={today} value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </FormField>
          <FormField id="ov-open" label="That day">
            <select id="ov-open" className={selectClass} value={form.is_open ? "open" : "closed"}
              onChange={(e) => set({ is_open: e.target.value === "open", capacity_cars: e.target.value === "open" && weekday?.capacity_cars ? String(weekday.capacity_cars) : "" })}>
              <option value="closed">Closed</option>
              <option value="open">Open (special hours or capacity)</option>
            </select>
          </FormField>
          {form.is_open ? (
            <>
              <FormField id="ov-cap" label="Cars" error={errors.capacity_cars}>
                <Input id="ov-cap" inputMode="numeric" value={form.capacity_cars} invalid={!!errors.capacity_cars}
                  onChange={(e) => set({ capacity_cars: e.target.value.replace(/\D/g, "") })} />
              </FormField>
              <FormField id="ov-hours" label="Hours (optional)" error={errors.close_time} hint="Leave blank for the usual hours.">
                <div className="flex items-center gap-2">
                  <Input id="ov-hours" aria-label="Opens" type="time" value={form.open_time} onChange={(e) => set({ open_time: e.target.value })} />
                  <span className="text-muted">to</span>
                  <Input aria-label="Closes" type="time" value={form.close_time} onChange={(e) => set({ close_time: e.target.value })} />
                </div>
              </FormField>
            </>
          ) : (
            <div className="sm:col-span-2">
              <ToggleRow id="ov-phone" label="Show my phone number to customers"
                description="On /book this day says “Not available online. Call the workshop”. Off: it just shows as closed."
                checked={form.show_phone} onCheckedChange={(v) => set({ show_phone: v })} />
            </div>
          )}
          <FormField id="ov-reason" label="Reason (only you see this)" error={errors.reason} className="sm:col-span-2">
            <Input id="ov-reason" maxLength={100} value={form.reason} onChange={(e) => set({ reason: e.target.value })} />
          </FormField>
        </div>

        {warning ? (
          <div role="alert" className="mt-5 rounded-[12px] border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="h-5 w-5" aria-hidden="true" />
              {warning.bookings.length === 1 ? "1 booking on this day" : `${warning.bookings.length} bookings on this day`}
            </p>
            <p className="mt-1 text-sm">
              {warning.row.is_open ? "That's more than the new capacity." : "Closing the day doesn't cancel them."} Open each one to
              cancel or move it (the customer gets a text).
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {warning.bookings.map((b) => (
                <li key={b.id}>
                  <Link href={`/dashboard/bookings/${b.id}`} target="_blank" className="font-semibold text-primary hover:underline">
                    {b.first_name} {b.last_name}
                  </Link>{" "}
                  · <span className="font-mono">{b.rego}</span> · {b.reference_no}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => write(warning.row)}>
                {busy && <Loader2 className="animate-spin" />} {warning.row.is_open ? "Save anyway" : "Close the day anyway"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setWarning(null)}>Back</Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex justify-end">
            <Button disabled={busy || !form.date} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Save date
            </Button>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------- services
type ServiceDraft = { id?: string; name: string; description: string; price_type: ServiceRow["price_type"]; price: string; online_bookable: boolean; active: boolean };
const serviceDraft = (s?: ServiceRow): ServiceDraft => ({
  id: s?.id,
  name: s?.name ?? "",
  description: s?.description ?? "",
  price_type: s?.price_type ?? "quote",
  price: s?.price_cents == null ? "" : String(s.price_cents / 100),
  online_bookable: s?.online_bookable ?? true,
  active: s?.active ?? true,
});

function ServicesCard({ services, onChanged }: { services: ServiceRow[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<ServiceDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    const { id, ...rest } = editing;
    const p = ServiceForm.safeParse(rest);
    if (!p.success) return setErrors(fieldErrors(p.error));
    setErrors({});
    setBusy(true);
    try {
      const sort = id ? services.find((s) => s.id === id)!.sort_order : Math.max(0, ...services.map((s) => s.sort_order)) + 10;
      await saveService({ id, ...p.data, sort_order: sort });
      toast.success(id ? "Service saved" : "Service added");
      setEditing(null);
      onChanged();
    } catch (e) {
      toast.error("Couldn't save", { description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  const form = editing && (
    <div className="space-y-4 rounded-[12px] border border-primary/30 bg-slate-50 p-4">
      <FormField id="svc-name" label="Name" error={errors.name}>
        <Input id="svc-name" maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
      </FormField>
      <FormField id="svc-desc" label="Description (optional)" error={errors.description}>
        <Input id="svc-desc" maxLength={300} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="svc-ptype" label="Price">
          <select id="svc-ptype" className={selectClass} value={editing.price_type}
            onChange={(e) => setEditing({ ...editing, price_type: e.target.value as ServiceDraft["price_type"] })}>
            <option value="quote">Price on inspection</option>
            <option value="from">From $…</option>
            <option value="fixed">Fixed $…</option>
          </select>
        </FormField>
        {editing.price_type !== "quote" && (
          <FormField id="svc-price" label="Dollars" error={errors.price}>
            <Input id="svc-price" inputMode="decimal" value={editing.price} invalid={!!errors.price}
              onChange={(e) => setEditing({ ...editing, price: e.target.value.replace(/[^\d.]/g, "") })} />
          </FormField>
        )}
      </div>
      <div className="divide-y divide-line">
        <ToggleRow id="svc-online" label="Customers can book it online" checked={editing.online_bookable}
          onCheckedChange={(v) => setEditing({ ...editing, online_bookable: v })} />
        <ToggleRow id="svc-active" label="Active" description="Off hides it everywhere. Services are never deleted (old bookings keep their name)."
          checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => { setEditing(null); setErrors({}); }}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{busy ? <Loader2 className="animate-spin" /> : <Save />} Save service</Button>
      </div>
    </div>
  );

  return (
    <SettingsCard title="Services and prices" description="What customers can choose on /book.">
      <ul className="divide-y divide-line rounded-[12px] border border-line">
        {services.map((s) =>
          editing?.id === s.id ? (
            <li key={s.id} className="p-2">{form}</li>
          ) : (
            <li key={s.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", !s.active && "opacity-60")}>
              <div className="min-w-0">
                <p className="font-semibold">{s.name}</p>
                <p className="text-sm text-muted">
                  {formatPrice(s.price_type, s.price_cents)}
                  {!s.active ? " · Inactive" : !s.online_bookable ? " · Not online" : ""}
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={!!editing} onClick={() => setEditing(serviceDraft(s))}>Edit</Button>
            </li>
          ),
        )}
      </ul>
      <div className="mt-4">
        {editing && !editing.id ? form : (
          <Button variant="outline" disabled={!!editing} onClick={() => setEditing(serviceDraft())}><Plus /> Add service</Button>
        )}
      </div>
    </SettingsCard>
  );
}

// ---------------------------------------------------------------- drop-off windows
function WindowsCard({ windows, onChanged }: { windows: WindowRow[]; onChanged: () => void }) {
  const [adding, setAdding] = useState<{ start_time: string; end_time: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = windows.filter((w) => w.active);

  async function run(fn: () => Promise<void>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error("Couldn't save", { description: errMsg(e) });
    }
  }
  async function add() {
    const p = WindowForm.safeParse(adding);
    if (!p.success) return setError(Object.values(fieldErrors(p.error))[0]);
    setError(null);
    await run(() => saveWindow({ ...p.data, active: true, sort_order: Math.max(0, ...windows.map((w) => w.sort_order)) + 10 }), "Drop-off time added");
    setAdding(null);
  }

  return (
    <SettingsCard title="Drop-off times" description="With one time, customers aren't asked to choose.">
      <ul className="divide-y divide-line rounded-[12px] border border-line">
        {windows.map((w) => {
          const lastActive = w.active && active.length === 1;
          return (
            <li key={w.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", !w.active && "opacity-60")}>
              <span className="font-semibold">{formatWindow(w.start_time, w.end_time)}</span>
              <span className="flex items-center gap-3">
                <Switch aria-label={`Offer ${formatWindow(w.start_time, w.end_time)}`} checked={w.active} disabled={lastActive}
                  onCheckedChange={(v) => run(() => saveWindow({ ...w, active: v }), v ? "Drop-off time on" : "Drop-off time off")} />
                <Button variant="ghost" size="sm" disabled={lastActive} aria-label={`Remove ${formatWindow(w.start_time, w.end_time)}`}
                  onClick={() => run(() => deleteWindow(w.id), "Drop-off time removed")}>
                  <X />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
      {active.length === 1 && <p className="mt-2 text-sm text-muted">Keep at least one drop-off time on.</p>}
      <div className="mt-4">
        {adding ? (
          <div className="flex flex-wrap items-end gap-2">
            <Input aria-label="From" type="time" className="h-11 w-32" value={adding.start_time} onChange={(e) => setAdding({ ...adding, start_time: e.target.value })} />
            <span className="pb-3 text-muted">to</span>
            <Input aria-label="To" type="time" className="h-11 w-32" value={adding.end_time} onChange={(e) => setAdding({ ...adding, end_time: e.target.value })} />
            <Button onClick={add}><Save /> Add</Button>
            <Button variant="ghost" onClick={() => { setAdding(null); setError(null); }}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAdding({ start_time: "", end_time: "" })}><Plus /> Add drop-off time</Button>
        )}
        {error && <p role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>}
      </div>
    </SettingsCard>
  );
}
