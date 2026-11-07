"use client";

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Loader2, Printer, X } from "lucide-react";
import { useDashboard } from "@/components/dashboard/shell";
import { useJob } from "@/components/jobs/use-job";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { formatHours, formatMoney, jobTotals, totalHours } from "@/lib/jobs";
import { DEFAULT_BUSINESS_NAME } from "@/lib/settings";
import { STATUS_LABEL } from "@/lib/types";
import { formatDate, formatDateTime, formatKm } from "@/lib/utils";

const MIN_WORK_LINES = 10;
const MIN_FAULT_LINES = 3;
const MIN_PART_ROWS = 10;

/** A4 job sheet in the same layout as the workshop's paper form. */
export default function PrintJobPage() {
  const { id } = useParams<{ id: string }>();
  const { settings } = useDashboard();
  const { job: j, state } = useJob(id);
  const printed = useRef(false);

  useEffect(() => {
    if (!j || printed.current) return;
    printed.current = true;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [j]);

  if (!j) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-muted">
        {state === "missing" ? "Job not found." : <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />}
      </div>
    );
  }

  const created = new Date(j.created_at);
  const totals = jobTotals(j);
  const hours = totalHours(j.time_in, j.time_out);
  const business = [settings.address, settings.phone, settings.email].filter(Boolean).join(" · ");
  const workLines = [...j.work_items, ...Array(Math.max(0, MIN_WORK_LINES - j.work_items.length)).fill("")];
  const faultLines = (j.faults ?? "").split("\n").filter(Boolean);
  const faultRows = [...faultLines, ...Array(Math.max(0, MIN_FAULT_LINES - faultLines.length)).fill("")];
  const partRows = [...j.parts, ...Array(Math.max(0, MIN_PART_ROWS - j.parts.length)).fill(null)];

  return (
    <div className="min-h-screen bg-slate-200 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-4">
        <Button variant="outline" onClick={() => window.close()}>
          <X /> Close
        </Button>
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>

      <article className="mx-auto box-border min-h-[297mm] w-full max-w-[210mm] bg-white p-[10mm] text-[10pt] text-ink shadow-xl print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-6 border-b-[3px] border-ink pb-2">
          <div>
            <Logo tone="light" className="h-[18mm]" />
            <p className="mt-1 text-[11pt] font-bold">{settings.business_name || DEFAULT_BUSINESS_NAME}</p>
            {settings.abn && <p className="text-[9pt] text-slate-600">ABN {settings.abn}</p>}
            {business && <p className="text-[9pt] text-slate-600">{business}</p>}
          </div>
          <div className="text-right">
            <p className="text-[9pt] uppercase tracking-[0.12em] text-slate-600">Job Sheet</p>
            <p className="font-mono text-[18pt] font-bold">{j.job_no}</p>
            <p className="text-[9.5pt]">
              <b>Day:</b> {created.toLocaleDateString("en-AU", { weekday: "long" })} &nbsp; <b>Date:</b> {formatDate(j.created_at)}
            </p>
            <p className="text-[9.5pt]">
              <b>Technician:</b> {j.employee_name} &nbsp; <b>Status:</b> {STATUS_LABEL[j.status]}
            </p>
          </div>
        </header>

        <Box title="Job Details">
          <Grid
            rows={[
              ["Name", j.customer_name, "Phone", j.phone],
              ["Email", j.email, "Address", j.address],
            ]}
          />
        </Box>

        <Box title="Vehicle Details">
          <Grid
            rows={[
              ["Rego", <b key="r" className="font-mono tracking-[0.1em]">{j.rego}</b>, "Make", j.make],
              ["Model", j.model, "Vehicle Type", j.vehicle_type],
              ["Year", j.year, "Colour", j.colour],
              ["KMs", j.odometer && /^\d+$/.test(j.odometer) ? `${formatKm(Number(j.odometer))} km` : j.odometer, "VIN", j.vin && <span className="font-mono">{j.vin}</span>],
            ]}
          />
        </Box>

        <Box title="Work Carried Out">
          {workLines.map((w, i) => (
            <Line key={i}>{w}</Line>
          ))}
        </Box>

        <Box title="Additional Faults Found">
          {faultRows.map((f, i) => (
            <Line key={i}>{f}</Line>
          ))}
        </Box>

        <table className="mt-3 w-full border-collapse border border-ink text-[9.5pt]">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-ink px-2 py-1 text-left">PARTS USED</th>
              <th className="w-[14mm] border border-ink px-2 py-1">Qty</th>
              <th className="w-[26mm] border border-ink px-2 py-1">Price each</th>
              <th className="w-[26mm] border border-ink px-2 py-1">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {partRows.map((p, i) => (
              <tr key={i} className="h-[6.5mm]">
                <td className="border border-slate-400 px-2">{p?.description}</td>
                <td className="border border-slate-400 px-2 text-center">{p?.qty}</td>
                <td className="border border-slate-400 px-2 text-right">{p?.price != null ? formatMoney(p.price) : ""}</td>
                <td className="border border-slate-400 px-2 text-right">{p?.price != null ? formatMoney((Number(p.qty) || 0) * p.price) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 grid grid-cols-3 border border-ink text-[9.5pt]">
          <dl className="space-y-1 border-r border-ink p-2">
            <Pair label="PO Number" value={j.po_number} />
            <Pair label="Tax Invoice Number" value={j.tax_invoice_number} />
            <Pair label="Date Inv Sent" value={j.invoice_sent_on ? formatDate(j.invoice_sent_on) : null} />
          </dl>
          <dl className="space-y-1 border-r border-ink p-2">
            <Pair label="Time in" value={j.time_in ? formatDateTime(j.time_in) : null} />
            <Pair label="Time out" value={j.time_out ? formatDateTime(j.time_out) : null} />
            <Pair label="TOTAL HOURS" value={hours ? `${hours} h` : j.hours ? formatHours(j.hours) : null} />
          </dl>
          <dl className="space-y-1 p-2">
            <Pair label="Sub Total Parts" value={totals.parts ? formatMoney(totals.parts) : null} />
            <Pair label="Sub Total Labour" value={j.labour_total != null ? formatMoney(totals.labour) : null} />
            <Pair label="GRAND TOTAL DUE" value={totals.total ? formatMoney(totals.total) : null} strong />
          </dl>
        </div>
      </article>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 border border-ink px-3 pb-2 pt-1.5">
      <h2 className="text-[10pt] font-bold uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ rows }: { rows: [string, React.ReactNode, string, React.ReactNode][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6">
      {rows.flatMap(([l1, v1, l2, v2]) => [
        <Line key={l1} label={l1}>
          {v1}
        </Line>,
        <Line key={l2} label={l2}>
          {v2}
        </Line>,
      ])}
    </div>
  );
}

function Line({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-[6.5mm] items-end gap-2 border-b border-slate-400 pb-0.5">
      {label && <span className="shrink-0 text-slate-600">{label}:</span>}
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function Pair({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-2 font-bold" : "flex justify-between gap-2"}>
      <dt className={strong ? undefined : "text-slate-600"}>{label}:</dt>
      <dd className="text-right">{value ?? ""}</dd>
    </div>
  );
}
