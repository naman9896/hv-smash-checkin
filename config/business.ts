/**
 * Everything that identifies the business: name, logo, colours and customer-facing text.
 * Change it here, and only here, to re-brand the app.
 *
 * Contact details below are the defaults. The owner can override them in
 * Dashboard → Settings → Business Details (stored in the database).
 *
 * Two places can't import this file:
 *   - supabase/migrations/0001_checkin.sql repeats `referencePrefix` (the `reference_no` default)
 *   - supabase/functions/notify-checkin (Deno) reads the name from its BUSINESS_NAME secret
 */
export const business = {
  /** Full trading name, shown on the kiosk, dashboard, print sheet and browser tab. */
  name: "Hunter Valley Smash & Repair",
  /** Short name for the home-screen icon and tight spaces. */
  shortName: "HV Smash & Repair",
  tagline: "Body & panel repairs on all makes and models",
  location: "Rutherford, NSW",

  /** Prefix of the reference numbers the kiosk hands out (HVS-1001, HVS-1002…). */
  referencePrefix: "HVS",

  contact: {
    phone: "02 4932 4551",
    email: "admin@huntervalleysmashrepair.com.au",
    address: "9 Shipley Dr, Rutherford NSW 2320",
  },

  /** Files in /public. Regenerate them from design/logo-source.jpg with design/make-icons.mjs. */
  logo: {
    /** Transparent PNG of the red roundel; works on light and dark backgrounds. */
    src: "/logo.png",
    alt: "Hunter Valley Smash Repairs",
  },

  /**
   * Theme colours (hex). Taken from the business's website: brand red, charcoal, light grey.
   * They become CSS variables in the root layout; Tailwind classes such as `bg-primary`
   * and `bg-navy` read them (see src/app/globals.css).
   */
  colors: {
    /** Buttons, links, focus rings, highlights. */
    primary: "#9B2423",
    primaryHover: "#7D1C1B",
    /** Dark surfaces: headers, kiosk thank-you screen, login. */
    dark: "#231F20",
    darkRaised: "#332D2E",
    /** Page background and borders. */
    page: "#F2F2F2",
    line: "#E3E1E1",
    /** Body text and secondary text. */
    ink: "#1F1B1C",
    muted: "#6B6466",
    /** Small accent on dark surfaces (returning-customer badge, paused icon). */
    accent: "#F2C14E",
  },

  /** Customer-facing kiosk text. The owner can override title, subtitle and consent in Settings → Kiosk. */
  kiosk: {
    title: "Vehicle Check-in",
    subtitle: "Please fill in your details, describe the damage and sign below.",
    consent:
      "By signing, you confirm that the details provided are accurate and authorise Hunter Valley Smash & Repair to inspect your vehicle and prepare a repair quote.",
    pausedMessage: "Check-in is currently unavailable – please see the front counter.",
    thankYou: "Your vehicle is checked in. Our team has your details and will be in touch about the repair.",
  },
} as const;

export type Business = typeof business;
