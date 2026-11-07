export const STATUSES = ["new", "in_progress", "completed", "cancelled"] as const;
export type CheckinStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<CheckinStatus, string> = {
  new: "New",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const JOB_TYPES = ["insurance", "private"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  insurance: "Insurance",
  private: "Private",
};

/** A row of `public.checkins`. */
export interface Checkin {
  id: string;
  reference_no: string;
  created_at: string;
  updated_at: string;
  status: CheckinStatus;

  customer_name: string;
  email: string;
  /** Digits only, national format: 0403343004 or 0249324551. */
  phone: string;

  make: string;
  model: string;
  year: number | null;

  job_type: JobType | null;
  insurance_company: string | null;
  claim_number: string | null;
  damage_description: string | null;

  /** Path of the PNG in the private `signatures` bucket. */
  signature_path: string;
  signed_at: string;

  internal_notes: string | null;
  is_read: boolean;
  is_archived: boolean;
  returning_customer: boolean;
}

/** The clean, validated check-in the API route sends to the database (see `checkinSchema`). */
export interface CheckinInput {
  customer_name: string;
  email: string;
  phone: string;
  make: string;
  model: string;
  year: number | null;
  job_type: JobType | null;
  insurance_company: string | null;
  claim_number: string | null;
  damage_description: string | null;
}

export type CheckinPatch = Partial<Pick<Checkin, "status" | "internal_notes" | "is_read" | "is_archived">>;

/** Public kiosk settings (the `kiosk_settings` view). No PIN, contact or ABN data. */
export interface KioskSettings {
  kiosk_enabled: boolean;
  kiosk_paused_message: string | null;
  kiosk_title: string | null;
  kiosk_subtitle: string | null;
  consent_text: string | null;
  thank_you_reset_seconds: number;
  idle_timeout_minutes: number;
  pin_set: boolean;
  updated_at: string | null;
}

export const CHIMES = ["chime-1", "chime-2", "chime-3"] as const;
export type Chime = (typeof CHIMES)[number];

/** Owner settings (the `settings` table, minus pin_hash which is never readable). */
export interface Settings {
  owner_name: string | null;
  abn: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  opening_hours: string | null;
  auto_lock_minutes: 0 | 5 | 15 | 30;
  kiosk_enabled: boolean;
  kiosk_paused_message: string | null;
  kiosk_title: string | null;
  kiosk_subtitle: string | null;
  consent_text: string | null;
  thank_you_reset_seconds: number;
  idle_timeout_minutes: number;
  sound_enabled: boolean;
  chime: Chime;
  browser_notifications: boolean;
  email_alerts: boolean;
  archive_after_months: number | null;
  updated_at: string | null;
}

export type SettingsPatch = Partial<Omit<Settings, "updated_at">>;
