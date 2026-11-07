import { JOB_TYPE_LABEL, STATUS_LABEL, type Checkin } from "./types";

const COLUMNS: [string, (c: Checkin) => string | number | null | undefined][] = [
  ["Reference", (c) => c.reference_no],
  ["Checked in", (c) => new Date(c.created_at).toLocaleString("en-AU")],
  ["Status", (c) => STATUS_LABEL[c.status]],
  ["Name", (c) => c.customer_name],
  ["Phone", (c) => c.phone],
  ["Email", (c) => c.email],
  ["Make", (c) => c.make],
  ["Model", (c) => c.model],
  ["Year", (c) => c.year],
  ["Job type", (c) => (c.job_type ? JOB_TYPE_LABEL[c.job_type] : "")],
  ["Insurance company", (c) => c.insurance_company],
  ["Claim number", (c) => c.claim_number],
  ["Damage description", (c) => c.damage_description],
  ["Signed at", (c) => new Date(c.signed_at).toLocaleString("en-AU")],
  ["Returning customer", (c) => (c.returning_customer ? "Yes" : "No")],
  ["Archived", (c) => (c.is_archived ? "Yes" : "No")],
  ["Internal notes", (c) => c.internal_notes],
];

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Stop spreadsheet apps from treating customer input as a formula
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function checkinsToCsv(rows: Checkin[]): string {
  const lines = [COLUMNS.map(([h]) => cell(h)).join(",")];
  rows.forEach((r) => lines.push(COLUMNS.map(([, get]) => cell(get(r))).join(",")));
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
