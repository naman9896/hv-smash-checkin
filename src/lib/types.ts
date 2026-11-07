export const STATUSES = ["new", "in_progress", "completed", "cancelled"] as const;
export type CheckinStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<CheckinStatus, string> = {
  new: "New",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export interface Checkin {
  id: string;
  reference_no: string;
  created_at: string;
  updated_at: string;
  status: CheckinStatus;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  make: string;
  model: string;
  year: number | null;
  rego: string;
  colour: string | null;
  odometer_km: number | null;
  signature_path: string | null;
  /** When the customer submitted the form (and signed, for older check-ins). */
  signed_at: string | null;
  internal_notes: string | null;
  is_read: boolean;
  is_archived: boolean;
  returning_customer: boolean;
  /** Mechanic (from Settings → Staff) the owner assigned this car to. */
  assigned_to: string | null;
  /** Owner's instructions for the mechanic. */
  assigned_note: string | null;
  assigned_at: string | null;
}

/** What the kiosk sends. No id/status/notes – the server owns those. */
export interface CheckinInput {
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  make: string;
  model: string;
  year: number | null;
  rego: string;
  colour: string | null;
  odometer_km: number | null;
}

export type CheckinPatch = Partial<Pick<Checkin, "status" | "internal_notes" | "is_read" | "is_archived" | "assigned_to" | "assigned_note">>;

/** A car assigned to a mechanic, as shown on their Staff Job Sheet list (no customer details). */
export interface StaffAssignment {
  checkin_id: string;
  reference_no: string;
  rego: string;
  make: string;
  model: string;
  year: number | null;
  colour: string | null;
  odometer_km: number | null;
  note: string | null;
  assigned_at: string | null;
  checked_in_at: string;
}

/** Public kiosk settings (the `kiosk_settings` view). No PIN, contact or ABN data. */
export interface KioskSettings {
  business_name: string | null;
  logo_path: string | null;
  kiosk_enabled: boolean;
  kiosk_paused_message: string | null;
  kiosk_title: string | null;
  kiosk_subtitle: string | null;
  consent_text: string | null;
  show_year: boolean;
  show_colour: boolean;
  show_odometer: boolean;
  email_required: boolean;
  quick_makes: string[];
  thank_you_reset_seconds: number;
  idle_timeout_minutes: number;
  pin_set: boolean;
  staff_pin_set: boolean;
  updated_at: string | null;
}

export const CHIMES = ["chime-1", "chime-2", "chime-3"] as const;
export type Chime = (typeof CHIMES)[number];

/** Owner settings (the `settings` table, minus pin_hash which is never readable). */
export interface Settings {
  business_name: string | null;
  owner_name: string | null;
  abn: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  opening_hours: string | null;
  logo_path: string | null;
  auto_lock_minutes: 0 | 5 | 15 | 30;
  kiosk_enabled: boolean;
  kiosk_paused_message: string | null;
  kiosk_title: string | null;
  kiosk_subtitle: string | null;
  consent_text: string | null;
  show_year: boolean;
  show_colour: boolean;
  show_odometer: boolean;
  email_required: boolean;
  quick_makes: string[];
  thank_you_reset_seconds: number;
  idle_timeout_minutes: number;
  sound_enabled: boolean;
  chime: Chime;
  browser_notifications: boolean;
  email_alerts: boolean;
  archive_after_months: number | null;
  staff_names: string[];
  updated_at: string | null;
}

export type SettingsPatch = Partial<Omit<Settings, "updated_at">>;

/* ------------------------------------------------------------------ */
/* Jobs (workshop job sheet)                                           */
/* ------------------------------------------------------------------ */

export interface JobPart {
  description: string;
  qty: number;
  /** Price each (owner only). */
  price?: number | null;
}

/** What staff fill in on /jobs (customer details: owner only – they come from the linked check-in). */
export interface JobStaffFields {
  employee_name: string;
  customer_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  rego: string;
  make: string;
  model: string | null;
  vehicle_type: string | null;
  vin: string | null;
  year: number | null;
  colour: string | null;
  /** KMs (digits). */
  odometer: string | null;
  /** Hours the job took, in half-hour steps ("0.5", "1", "1.5"…). */
  hours: string | null;
  work_items: string[];
  faults: string | null;
  parts: JobPart[];
}

/** Owner-only fields. */
export interface JobOwnerFields {
  status: CheckinStatus;
  time_in: string | null;
  time_out: string | null;
  labour_total: number | null;
  po_number: string | null;
  tax_invoice_number: string | null;
  invoice_sent_on: string | null;
  owner_notes: string | null;
}

export interface Job extends JobStaffFields, JobOwnerFields {
  id: string;
  job_no: string;
  created_at: string;
  updated_at: string;
  is_read: boolean;
  /** Customer check-in this job is linked to (set automatically by rego). */
  checkin_id: string | null;
}

export type JobPatch = Partial<JobStaffFields & JobOwnerFields & { is_read: boolean; checkin_id: string | null }>;
