import type { KioskSettings } from "./types";

export const DEFAULT_BUSINESS_NAME = "Sai Motor Works";

export const DEFAULT_QUICK_MAKES = ["Toyota", "Ford", "Mazda", "Hyundai", "Holden", "Volkswagen", "Subaru", "Kia", "Nissan", "BMW"];

export const DEFAULT_CONSENT =
  "By submitting this form, you confirm that the details provided are accurate and authorise Sai Motor Works to carry out an inspection of your vehicle.";

export const DEFAULT_PAUSED_MESSAGE = "Check-in is currently unavailable – please see the front counter.";

/** Used by the kiosk until the real settings arrive (and if they can't be loaded). */
export const DEFAULT_KIOSK_SETTINGS: KioskSettings = {
  business_name: DEFAULT_BUSINESS_NAME,
  logo_path: null,
  kiosk_enabled: true,
  kiosk_paused_message: DEFAULT_PAUSED_MESSAGE,
  kiosk_title: "Vehicle Check-in Form",
  kiosk_subtitle: "Please provide your contact details and vehicle information.",
  consent_text: DEFAULT_CONSENT,
  show_year: true,
  show_colour: true,
  show_odometer: true,
  email_required: true,
  quick_makes: DEFAULT_QUICK_MAKES,
  thank_you_reset_seconds: 8,
  idle_timeout_minutes: 3,
  pin_set: false,
  staff_pin_set: false,
  updated_at: null,
};

export const AUTO_LOCK_OPTIONS = [
  { value: 5, label: "5 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 0, label: "Never" },
] as const;

export const ARCHIVE_OPTIONS = [
  { value: null, label: "Never" },
  { value: 1, label: "After 1 month" },
  { value: 3, label: "After 3 months" },
  { value: 6, label: "After 6 months" },
  { value: 12, label: "After 12 months" },
  { value: 24, label: "After 24 months" },
] as const;
