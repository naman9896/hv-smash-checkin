"use client";

import { useState } from "react";
import { Car, Check, ChevronDown, HardHat, Package, Plus, Receipt, TriangleAlert, User, Wrench, X } from "lucide-react";
import { MakeSelect } from "@/components/make-select";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMMON_PARTS, COMMON_WORK, formatHours, formatMoney, HOURS_OPTIONS, jobTotals, totalHours, VEHICLE_TYPES } from "@/lib/jobs";
import { STATUSES, STATUS_LABEL, type JobOwnerFields, type JobPart, type JobStaffFields } from "@/lib/types";
import { cn, formatAuMobile, formatKm } from "@/lib/utils";
import { findMake } from "@/lib/vehicle-makes";

export type JobFormValue = JobStaffFields & Partial<JobOwnerFields>;

const textareaClass =
  "flex min-h-24 w-full rounded-[12px] border border-line bg-white px-4 py-3 text-[17px] text-ink placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15";
const selectClass =
  "h-14 w-full appearance-none rounded-[12px] border border-line bg-white pl-4 pr-11 text-[17px] text-ink focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15";

/** ISO ↔ <input type="datetime-local"> (local time). */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/**
 * The workshop job sheet, laid out like the paper form.
 * mode "staff": what employees fill in (no prices, times or invoice details).
 * mode "owner": everything, plus status, times, prices, labour and invoice details.
 */
export function JobForm({
  value: v,
  onChange,
  mode,
  staffNames,
  errors = {},
  popularMakes = [],
  hideEmployee = false,
}: {
  value: JobFormValue;
  onChange: (next: JobFormValue) => void;
  mode: "staff" | "owner";
  staffNames: string[];
  errors?: Record<string, string>;
  popularMakes?: string[];
  /** The employee is picked outside the form (staff name screen, job page header). */
  hideEmployee?: boolean;
}) {
  const [makeOther, setMakeOther] = useState(() => !!v.make && !findMake(v.make));
  const owner = mode === "owner";
  const set = <K extends keyof JobFormValue>(k: K, val: JobFormValue[K]) => onChange({ ...v, [k]: val });
  const text = (k: "customer_name" | "address" | "model" | "colour" | "vin") => ({
    id: `job-${k}`,
    value: (v[k] as string | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
    invalid: !!errors[k],
    className: "h-14",
  });

  const setPart = (i: number, patch: Partial<JobPart>) => set("parts", v.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const names = v.employee_name && !staffNames.includes(v.employee_name) ? [...staffNames, v.employee_name] : staffNames;
  const totals = jobTotals({ parts: v.parts, labour_total: v.labour_total ?? null });
  const hours = totalHours(v.time_in ?? null, v.time_out ?? null);

  return (
    <div className="space-y-6">
      {/* Technician (hidden where the name is chosen elsewhere) */}
      {!hideEmployee && (
        <Section icon={<HardHat />} title={owner ? "Technician" : "Your name"}>
          <Field id="job-employee_name" label="Employee" required error={errors.employee_name} className="max-w-sm">
            <div className="relative">
              <select
                id="job-employee_name"
                value={v.employee_name}
                onChange={(e) => set("employee_name", e.target.value)}
                aria-invalid={!!errors.employee_name || undefined}
                className={cn(selectClass, !v.employee_name && "text-slate-400", errors.employee_name && "border-danger bg-red-50/40")}
              >
                <option value="" disabled>
                  Select your name
                </option>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            </div>
          </Field>
        </Section>
      )}

      {/* Job details – owner only; filled in from the linked check-in */}
      {owner && (
        <Section icon={<User />} title="Job Details" subtitle="Filled in from the linked customer check-in when there is one.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="job-customer_name" label="Name" error={errors.customer_name}>
              <Input {...text("customer_name")} autoCapitalize="words" autoComplete="off" />
            </Field>
            <Field id="job-phone" label="Phone" error={errors.phone}>
              <Input
                id="job-phone"
                type="tel"
                inputMode="tel"
                placeholder="04XX XXX XXX"
                value={v.phone ?? ""}
                onChange={(e) => set("phone", /^0?4/.test(e.target.value.replace(/\D/g, "")) ? formatAuMobile(e.target.value) : e.target.value)}
                invalid={!!errors.phone}
                className="h-14"
              />
            </Field>
            <Field id="job-email" label="Email" error={errors.email}>
              <Input
                id="job-email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={v.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                invalid={!!errors.email}
                className="h-14"
              />
            </Field>
            <Field id="job-address" label="Address" error={errors.address}>
              <Input {...text("address")} autoCapitalize="words" />
            </Field>
          </div>
        </Section>
      )}

      {/* Vehicle details */}
      <Section icon={<Car />} title="Vehicle Details">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="job-rego" label="Rego" required error={errors.rego}>
            <Input
              id="job-rego"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={9}
              placeholder="ABC12D"
              value={v.rego}
              onChange={(e) => set("rego", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 9))}
              invalid={!!errors.rego}
              className="h-14 font-mono text-[19px] font-bold tracking-[0.15em] placeholder:font-normal"
            />
          </Field>
          <Field id="job-make" label="Make" required error={errors.make}>
            <MakeSelect
              id="job-make"
              value={v.make}
              other={makeOther}
              popular={popularMakes}
              onPick={(m, other) => {
                setMakeOther(other);
                set("make", m);
              }}
              onType={(m) => set("make", m)}
              invalid={!!errors.make}
            />
          </Field>
          <Field id="job-model" label="Model" required={!owner} error={errors.model}>
            <Input {...text("model")} autoCapitalize="words" />
          </Field>
          <Field id="job-vehicle_type" label="Vehicle Type">
            <div className="relative">
              <select
                id="job-vehicle_type"
                value={v.vehicle_type ?? ""}
                onChange={(e) => set("vehicle_type", e.target.value)}
                className={cn(selectClass, !v.vehicle_type && "text-slate-400")}
              >
                <option value="">Select type</option>
                {VEHICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            </div>
          </Field>
          <Field id="job-vin" label="VIN" error={errors.vin}>
            <Input
              {...text("vin")}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={17}
              onChange={(e) => set("vin", e.target.value.toUpperCase().replace(/\s/g, ""))}
              className="h-14 font-mono tracking-wider"
            />
          </Field>
          <Field id="job-year" label="Year" error={errors.year}>
            <Input
              id="job-year"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={v.year ?? ""}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, "").slice(0, 4);
                set("year", d ? Number(d) : null);
              }}
              invalid={!!errors.year}
              className="h-14"
            />
          </Field>
          <Field id="job-colour" label="Colour">
            <Input {...text("colour")} autoCapitalize="words" />
          </Field>
          <Field id="job-odometer" label="KMs" required={!owner} error={errors.odometer}>
            <div className="relative">
              <Input
                id="job-odometer"
                inputMode="numeric"
                pattern="[0-9,]*"
                placeholder="e.g. 85,000"
                value={v.odometer && /^\d+$/.test(v.odometer) ? formatKm(Number(v.odometer)) : (v.odometer ?? "")}
                onChange={(e) => set("odometer", e.target.value.replace(/\D/g, "").slice(0, 7))}
                invalid={!!errors.odometer}
                className="h-14 pr-12"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] font-medium text-muted">km</span>
            </div>
          </Field>
        </div>
      </Section>

      {/* Work carried out */}
      <Section icon={<Wrench />} title="Work Carried Out" id="job-work_items">
        <QuickPicks
          label="Common work – tap to add"
          options={COMMON_WORK}
          isSelected={(o) => v.work_items.some((w) => w.trim().toLowerCase() === o.toLowerCase())}
          onToggle={(o, selected) => {
            if (selected) {
              const left = v.work_items.filter((w) => w.trim().toLowerCase() !== o.toLowerCase());
              set("work_items", left.length ? left : [""]);
            } else {
              // Fill the first empty line, otherwise add a new one
              const empty = v.work_items.findIndex((w) => !w.trim());
              set("work_items", empty >= 0 ? v.work_items.map((w, i) => (i === empty ? o : w)) : [...v.work_items, o]);
            }
          }}
        />
        <ol className="space-y-2.5">
          {v.work_items.map((w, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-sm font-semibold text-muted">{i + 1}.</span>
              <Input
                aria-label={`Work carried out, line ${i + 1}`}
                value={w}
                placeholder={i === 0 ? "e.g. Service" : ""}
                onChange={(e) => set("work_items", v.work_items.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (i === v.work_items.length - 1) set("work_items", [...v.work_items, ""]);
                    setTimeout(() => (document.querySelector(`[aria-label="Work carried out, line ${i + 2}"]`) as HTMLInputElement | null)?.focus(), 30);
                  }
                }}
                invalid={!!errors.work_items && i === 0}
                className="h-12"
              />
              <RemoveButton
                label={`Remove line ${i + 1}`}
                disabled={v.work_items.length <= 1}
                onClick={() => set("work_items", v.work_items.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ol>
        {errors.work_items && (
          <p className="mt-2 text-[14px] font-medium text-danger" role="alert">
            {errors.work_items}
          </p>
        )}
        <AddButton onClick={() => set("work_items", [...v.work_items, ""])}>Add line</AddButton>

        <Field id="job-hours" label="Hours taken" error={errors.hours} className="mt-6 max-w-xs border-t border-line pt-5">
          <div className="relative">
            <select
              id="job-hours"
              value={v.hours ?? ""}
              onChange={(e) => set("hours", e.target.value || null)}
              className={cn(selectClass, !v.hours && "text-slate-400")}
            >
              <option value="">How long did the job take?</option>
              {/* Keep an older free-text value visible if it isn't a half-hour step */}
              {v.hours && !HOURS_OPTIONS.includes(v.hours) && <option value={v.hours}>{v.hours}</option>}
              {HOURS_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {formatHours(h)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
          </div>
        </Field>
      </Section>

      {/* Additional faults */}
      <Section icon={<TriangleAlert />} title="Additional Faults Found">
        <label htmlFor="job-faults" className="sr-only">
          Additional faults found
        </label>
        <textarea
          id="job-faults"
          className={textareaClass}
          placeholder="Anything else found that the customer should know about"
          value={v.faults ?? ""}
          onChange={(e) => set("faults", e.target.value)}
        />
      </Section>

      {/* Parts used */}
      <Section icon={<Package />} title="Parts Used">
        <QuickPicks
          label="Common parts – tap to add"
          options={COMMON_PARTS}
          isSelected={(o) => v.parts.some((p) => p.description.trim().toLowerCase() === o.toLowerCase())}
          onToggle={(o, selected) =>
            set(
              "parts",
              selected
                ? v.parts.filter((p) => p.description.trim().toLowerCase() !== o.toLowerCase())
                : [...v.parts.filter((p) => p.description.trim()), { description: o, qty: 1 }],
            )
          }
        />
        {v.parts.length > 0 && (
        <div className={cn("hidden gap-2 px-1 pb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted sm:grid", owner ? "sm:grid-cols-[1fr_80px_110px_100px_44px]" : "sm:grid-cols-[1fr_90px_44px]")}>
          <span>Part</span>
          <span>Qty</span>
          {owner && <span>Price each</span>}
          {owner && <span className="text-right">Total</span>}
          <span />
        </div>
        )}
        <ul className="space-y-3 sm:space-y-2">
          {v.parts.map((p, i) => (
            <li
              key={i}
              className={cn(
                "grid grid-cols-[1fr_44px] gap-2 rounded-[12px] border border-line p-2 sm:border-0 sm:p-0",
                owner ? "sm:grid-cols-[1fr_80px_110px_100px_44px]" : "sm:grid-cols-[1fr_90px_44px]",
              )}
            >
              <Input
                aria-label={`Part ${i + 1}`}
                placeholder={i === 0 ? "e.g. Air filter" : ""}
                value={p.description}
                onChange={(e) => setPart(i, { description: e.target.value })}
                className="h-12"
              />
              <div className={cn("col-span-2 grid gap-2 sm:contents", owner ? "grid-cols-3" : "grid-cols-1")}>
                <Input
                  aria-label={`Quantity for part ${i + 1}`}
                  inputMode="decimal"
                  value={p.qty === 0 ? "" : String(p.qty)}
                  onChange={(e) => setPart(i, { qty: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}
                  className="h-12"
                />
                {owner && (
                  <Input
                    aria-label={`Price each for part ${i + 1}`}
                    inputMode="decimal"
                    placeholder="$"
                    value={p.price == null ? "" : String(p.price)}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d.]/g, "");
                      setPart(i, { price: raw === "" ? null : Number(raw) });
                    }}
                    className="h-12"
                  />
                )}
                {owner && (
                  <span className="flex h-12 items-center justify-end font-semibold tabular-nums">
                    {formatMoney((Number(p.qty) || 0) * (Number(p.price) || 0))}
                  </span>
                )}
              </div>
              <RemoveButton
                label={`Remove part ${i + 1}`}
                onClick={() => set("parts", v.parts.filter((_, j) => j !== i))}
                className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
              />
            </li>
          ))}
        </ul>
        <AddButton onClick={() => set("parts", [...v.parts, { description: "", qty: 1 }])}>Add part</AddButton>
      </Section>

      {/* Owner only */}
      {owner && (
        <Section icon={<Receipt />} title="Time, Pricing & Invoice" subtitle="Only visible on the owner dashboard.">
          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="job-status" label="Status">
              <div className="relative">
                <select id="job-status" value={v.status ?? "new"} onChange={(e) => set("status", e.target.value as JobOwnerFields["status"])} className={selectClass}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
              </div>
            </Field>
            <Field id="job-time_in" label="Time in">
              <Input id="job-time_in" type="datetime-local" value={toLocalInput(v.time_in)} onChange={(e) => set("time_in", fromLocalInput(e.target.value))} className="h-14" />
            </Field>
            <Field id="job-time_out" label="Time out" error={errors.time_out}>
              <Input id="job-time_out" type="datetime-local" value={toLocalInput(v.time_out)} onChange={(e) => set("time_out", fromLocalInput(e.target.value))} invalid={!!errors.time_out} className="h-14" />
            </Field>
            <Field id="job-labour_total" label="Sub total labour ($)">
              <Input
                id="job-labour_total"
                inputMode="decimal"
                value={v.labour_total == null ? "" : String(v.labour_total)}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d.]/g, "");
                  set("labour_total", raw === "" ? null : Number(raw));
                }}
                className="h-14"
              />
            </Field>
            <Field id="job-po_number" label="PO number">
              <Input id="job-po_number" value={v.po_number ?? ""} onChange={(e) => set("po_number", e.target.value)} className="h-14" />
            </Field>
            <Field id="job-tax_invoice_number" label="Tax invoice number">
              <Input id="job-tax_invoice_number" value={v.tax_invoice_number ?? ""} onChange={(e) => set("tax_invoice_number", e.target.value)} className="h-14" />
            </Field>
            <Field id="job-invoice_sent_on" label="Date invoice sent">
              <Input id="job-invoice_sent_on" type="date" value={v.invoice_sent_on ?? ""} onChange={(e) => set("invoice_sent_on", e.target.value || null)} className="h-14" />
            </Field>
            <Field id="job-owner_notes" label="Owner notes" className="sm:col-span-2">
              <Input id="job-owner_notes" value={v.owner_notes ?? ""} onChange={(e) => set("owner_notes", e.target.value)} className="h-14" placeholder="Not shown to staff" />
            </Field>
          </div>

          <dl className="mt-6 grid gap-x-8 gap-y-2 rounded-[16px] bg-slate-50 p-5 text-[15px] sm:grid-cols-2">
            <SumRow
              label="Total hours"
              value={hours ? `${hours} h (time in/out)` : v.hours ? formatHours(v.hours) : "—"}
            />
            <SumRow label="Sub total parts" value={formatMoney(totals.parts)} />
            <span className="hidden sm:block" />
            <SumRow label="Sub total labour" value={formatMoney(totals.labour)} />
            <span className="hidden sm:block" />
            <SumRow label="Grand total due" value={formatMoney(totals.total)} strong />
          </dl>
        </Section>
      )}
    </div>
  );
}

function SumRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4", strong && "border-t border-line pt-2 text-lg")}>
      <dt className={cn("text-muted", strong && "font-bold text-ink")}>{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}

function Section({ icon, title, subtitle, id, children }: { icon: React.ReactNode; title: string; subtitle?: string; id?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-28 p-5 sm:p-7">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-blue-50 text-primary [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
        <div>
          <h2 className="text-lg font-bold uppercase tracking-[0.04em]">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

function Field({ id, label, required, error, className, children }: { id: string; label: string; required?: boolean; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-[14px] font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Tap-to-add buttons for common work / parts. Tapping a selected one removes it. */
function QuickPicks({
  label,
  options,
  isSelected,
  onToggle,
}: {
  label: string;
  options: string[];
  isSelected: (o: string) => boolean;
  onToggle: (o: string, selected: boolean) => void;
}) {
  return (
    <div className="mb-5">
      <p className="mb-2.5 text-sm font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = isSelected(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(o, selected)}
              className={cn(
                "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25",
                selected ? "border-primary bg-primary text-white" : "border-line bg-white text-ink hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              {selected ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4 text-muted" aria-hidden="true" />}
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex h-11 items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-4 text-sm font-semibold text-primary hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
    >
      <Plus className="h-4 w-4" aria-hidden="true" /> {children}
    </button>
  );
}

function RemoveButton({ label, onClick, disabled, className }: { label: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-12 w-11 shrink-0 items-center justify-center rounded-[12px] text-muted hover:bg-red-50 hover:text-danger disabled:opacity-30",
        className,
      )}
    >
      <X className="h-5 w-5" />
    </button>
  );
}

