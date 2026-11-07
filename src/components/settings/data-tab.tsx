"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { business } from "@config/business";
import { useDashboard } from "@/components/dashboard/shell";
import { FormField, SaveFooter, selectClass, SettingsCard, useSettingsDraft } from "@/components/settings/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { checkinsToCsv, downloadCsv } from "@/lib/csv";
import { deleteCheckins, queryCheckins, runAutoArchive } from "@/lib/data";
import { ARCHIVE_OPTIONS } from "@/lib/settings";
import { STATUSES, STATUS_LABEL, type Checkin } from "@/lib/types";
import { dayInputBounds, formatAuPhone, formatDate, vehicleTitle } from "@/lib/utils";

const KEYS = ["archive_after_months"] as const;

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DataTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { refresh, removeRows } = useDashboard();
  const archive = useSettingsDraft(KEYS);

  // Export
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return isoDay(d);
  });
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [status, setStatus] = useState("all");
  const [exporting, setExporting] = useState(false);

  // Delete
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Checkin[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => onDirty(archive.dirty), [archive.dirty, onDirty]);

  async function onExport() {
    const b = dayInputBounds(from, to);
    if (b.from && b.to && b.from >= b.to) return toast.error("The start date must be before the end date.");
    setExporting(true);
    try {
      const rows = await queryCheckins({ from: b.from?.toISOString(), to: b.to?.toISOString(), status });
      if (!rows.length) return toast.info("No check-ins in that range.");
      downloadCsv(`${business.shortName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-checkins_${from || "start"}_to_${to || "today"}.csv`, checkinsToCsv(rows));
      toast.success(`Exported ${rows.length} check-in${rows.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  async function onSaveArchive() {
    if (await archive.save()) {
      const n = await runAutoArchive().catch(() => 0);
      if (n) toast.info(`${n} completed job${n === 1 ? "" : "s"} archived`);
      refresh();
    }
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (search.trim().length < 2) return;
    setSearching(true);
    try {
      const rows = await queryCheckins({ search });
      setResults(rows);
      setSelected(new Set(rows.map((r) => r.id)));
    } catch (err) {
      toast.error("Search failed", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSearching(false);
    }
  }

  async function onDelete() {
    const rows = (results ?? []).filter((r) => selected.has(r.id));
    setDeleting(true);
    try {
      await deleteCheckins(rows);
      removeRows(rows.map((r) => r.id));
      setResults((rs) => (rs ?? []).filter((r) => !selected.has(r.id)));
      setSelected(new Set());
      toast.success(`Deleted ${rows.length} check-in${rows.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error("Delete failed", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setDeleting(false);
      setStep(0);
      setTyped("");
    }
  }

  const count = selected.size;

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Export to CSV"
        description="Download check-ins for a date range (archived ones included). Opens in Excel, Numbers or Google Sheets."
        footer={
          <Button onClick={onExport} disabled={exporting}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />} Export CSV
          </Button>
        }
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <FormField id="export-from" label="From">
            <Input id="export-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField id="export-to" label="To (inclusive)">
            <Input id="export-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </FormField>
          <FormField id="export-status" label="Status">
            <select id="export-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Auto-archive"
        description="Hide completed jobs from the main list after a while. Archived jobs are kept and can be shown with “Show archived” on the dashboard."
        footer={<SaveFooter dirty={archive.dirty} saving={archive.saving} onSave={onSaveArchive} onDiscard={archive.discard} />}
      >
        <FormField id="archive-after" label="Archive completed jobs" className="max-w-xs">
          <select
            id="archive-after"
            className={selectClass}
            value={archive.draft.archive_after_months ?? ""}
            onChange={(e) => archive.set("archive_after_months", e.target.value ? Number(e.target.value) : null)}
          >
            {ARCHIVE_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
      </SettingsCard>

      <SettingsCard
        title="Delete a customer's records"
        description="For privacy requests. Permanently deletes the selected check-ins (and any signatures from older check-ins). This can't be undone."
      >
        <form onSubmit={onSearch} className="flex max-w-xl gap-2">
          <label htmlFor="privacy-search" className="sr-only">
            Search by name, phone, email or claim number
          </label>
          <Input id="privacy-search" placeholder="Name, phone, email or claim number" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button type="submit" variant="outline" className="h-12" disabled={searching || search.trim().length < 2}>
            {searching ? <Loader2 className="animate-spin" /> : <Search />} Find
          </Button>
        </form>

        {results && (
          <div className="mt-5">
            {results.length === 0 ? (
              <p className="text-sm text-muted">No matching check-ins.</p>
            ) : (
              <>
                <ul className="divide-y divide-line rounded-[12px] border border-line">
                  {results.map((r) => (
                    <li key={r.id}>
                      <label className="flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-[var(--color-danger)]"
                          checked={selected.has(r.id)}
                          onChange={(e) =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(r.id);
                              else n.delete(r.id);
                              return n;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="block font-semibold">{r.customer_name}</span>
                          <span className="block truncate text-muted">
                            {formatAuPhone(r.phone)} · {r.email}
                          </span>
                          <span className="block truncate text-muted">{vehicleTitle(r)}</span>
                        </span>
                        <span className="text-right text-xs text-muted">
                          <span className="block font-mono">{r.reference_no}</span>
                          {formatDate(r.created_at)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex justify-end">
                  <Button variant="destructive" disabled={!count} onClick={() => setStep(1)}>
                    <Trash2 /> Delete {count} record{count === 1 ? "" : "s"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </SettingsCard>

      <Modal
        open={step === 1}
        onOpenChange={(o) => !o && setStep(0)}
        icon={<AlertTriangle className="text-danger" />}
        title={`Delete ${count} check-in${count === 1 ? "" : "s"}?`}
        description="The customer details (and any signatures) will be removed permanently."
      >
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={() => setStep(0)}>
            Cancel
          </Button>
          <Button variant="destructive" size="lg" onClick={() => setStep(2)}>
            Continue
          </Button>
        </div>
      </Modal>

      <Modal
        open={step === 2}
        onOpenChange={(o) => {
          if (!o) {
            setStep(0);
            setTyped("");
          }
        }}
        icon={<Trash2 className="text-danger" />}
        title="Are you absolutely sure?"
        description={
          <>
            Type <span className="font-mono font-bold text-ink">DELETE</span> to confirm.
          </>
        }
      >
        <label htmlFor="type-delete" className="sr-only">
          Type DELETE to confirm
        </label>
        <Input id="type-delete" className="mt-5 text-center font-mono" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={() => setStep(0)}>
            Cancel
          </Button>
          <Button variant="destructive" size="lg" disabled={typed.trim().toUpperCase() !== "DELETE" || deleting} onClick={onDelete}>
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete forever
          </Button>
        </div>
      </Modal>
    </div>
  );
}
