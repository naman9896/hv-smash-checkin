"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Printer, X } from "lucide-react";
import { useDashboard } from "@/components/dashboard/shell";
import { useCheckin } from "@/components/dashboard/use-checkin";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { getSignatureUrl } from "@/lib/data";
import { business } from "@config/business";
import { DEFAULT_CONSENT } from "@/lib/settings";
import { JOB_TYPE_LABEL, STATUS_LABEL } from "@/lib/types";
import { formatAuPhone, formatDateTime, phoneLabel } from "@/lib/utils";

/** A4 check-in sheet. Opens the print dialog once ready (after the signature has loaded). */
export default function PrintCheckinSheetPage() {
  const { id } = useParams<{ id: string }>();
  const { settings } = useDashboard();
  const { checkin: c, state } = useCheckin(id);
  const [sigUrl, setSigUrl] = useState<string | null | undefined>(undefined);
  const [sigLoaded, setSigLoaded] = useState(false);
  const printed = useRef(false);

  useEffect(() => {
    if (!c) return;
    getSignatureUrl(c.signature_path).then(setSigUrl);
  }, [c]);

  const ready = !!c && sigUrl !== undefined && (sigUrl === null || sigLoaded);
  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [ready]);

  if (state === "loading" || !c) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-muted">
        {state === "missing" ? "Check-in not found." : <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />}
      </div>
    );
  }

  const contact = [
    settings.address || business.contact.address,
    settings.phone || business.contact.phone,
    settings.email || business.contact.email,
  ].join(" · ");

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

      <article className="job-sheet mx-auto box-border min-h-[297mm] w-full max-w-[210mm] bg-white p-[12mm] text-[11pt] text-ink shadow-xl print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-[3px] border-ink pb-3">
          <div>
            <Logo tone="light" className="h-[24mm]" />
            <p className="mt-2 text-[12pt] font-bold">{business.name}</p>
            {settings.abn && <p className="text-[9.5pt] text-slate-600">ABN {settings.abn}</p>}
            <p className="text-[9.5pt] text-slate-600">{contact}</p>
          </div>
          <div className="text-right">
            <p className="text-[9pt] uppercase tracking-[0.12em] text-slate-600">Vehicle Check-in</p>
            <p className="font-mono text-[18pt] font-bold">{c.reference_no}</p>
            <p className="mt-1 text-[9.5pt]">Checked in {formatDateTime(c.created_at)}</p>
            <p className="text-[9.5pt]">Status: {STATUS_LABEL[c.status]}</p>
          </div>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-5">
          <SheetTable
            title="Customer"
            rows={[
              ["Name", c.customer_name],
              [phoneLabel(c.phone), formatAuPhone(c.phone)],
              ["Email", c.email],
            ]}
          />
          <SheetTable
            title="Vehicle"
            rows={[
              ["Make", c.make],
              ["Model", c.model],
              ["Year", c.year],
            ]}
          />
        </div>

        <div className="mt-5">
          <SheetTable
            title="Job"
            rows={[
              ["Job type", c.job_type && JOB_TYPE_LABEL[c.job_type]],
              ...(c.job_type === "insurance"
                ? ([
                    ["Insurance company", c.insurance_company],
                    ["Claim number", c.claim_number],
                  ] as [string, React.ReactNode][])
                : []),
              ["Damage description", c.damage_description && <span className="whitespace-pre-wrap">{c.damage_description}</span>],
            ]}
          />
        </div>

        <h2 className="mb-1.5 mt-5 text-[12pt] font-bold">Workshop notes</h2>
        {c.internal_notes && <p className="mb-2 whitespace-pre-wrap text-[10pt] text-slate-700">{c.internal_notes}</p>}
        <div aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-[9mm] border-b border-slate-400" />
          ))}
        </div>

        <h2 className="mb-1.5 mt-6 text-[12pt] font-bold">Customer authorisation</h2>
        <p className="text-[9.5pt] text-slate-700">{settings.consent_text || DEFAULT_CONSENT}</p>
        <div className="mt-2 flex items-end gap-6">
          <div className="flex h-[24mm] flex-1 items-end border-b border-ink">
            {sigUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sigUrl} alt="Customer signature" className="max-h-[23mm] max-w-full" onLoad={() => setSigLoaded(true)} onError={() => setSigLoaded(true)} />
            )}
          </div>
          <div className="w-[60mm] text-[10pt]">Signed {formatDateTime(c.signed_at)}</div>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-6 text-[10pt]">
          {["Assessed by", "Completed date", "Customer collected"].map((l) => (
            <div key={l} className="border-t border-slate-400 pt-1">
              {l}
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function SheetTable({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <div>
      <h2 className="mb-1.5 text-[12pt] font-bold">{title}</h2>
      <table className="w-full border-collapse text-[10.5pt]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th className="w-[38%] border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-left font-semibold">{label}</th>
              <td className="border border-slate-300 px-2.5 py-1.5">{value || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
