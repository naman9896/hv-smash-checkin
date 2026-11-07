import { business } from "@config/business";
import type { KioskSettings } from "./types";

export const DEFAULT_CONSENT = business.kiosk.consent;
export const DEFAULT_PAUSED_MESSAGE = business.kiosk.pausedMessage;

/** Used by the kiosk until the real settings arrive (and if they can't be loaded). */
export const DEFAULT_KIOSK_SETTINGS: KioskSettings = {
  kiosk_enabled: true,
  kiosk_paused_message: null,
  kiosk_title: null,
  kiosk_subtitle: null,
  consent_text: null,
  thank_you_reset_seconds: 5,
  idle_timeout_minutes: 3,
  pin_set: false,
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
