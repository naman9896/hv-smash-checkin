// Display helpers shared by the booking page and SMS previews. Same output as the SQL helpers.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** '2026-11-12' → 'Thu 12 Nov' (a calendar date, no time zone involved). */
export function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 'Thursday 12 November' for headings. */
export function formatDayLong(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  });
}

function clock(t: string): { text: string; pm: boolean } {
  const [h, m] = t.split(":").map(Number);
  return { text: `${h % 12 || 12}:${String(m).padStart(2, "0")}`, pm: h >= 12 };
}

/** '08:30:00','09:30:00' → '8:30–9:30am'; '11:30','12:30' → '11:30am–12:30pm'. */
export function formatWindow(start: string, end: string): string {
  const s = clock(start);
  const e = clock(end);
  return `${s.text}${s.pm === e.pm ? "" : s.pm ? "pm" : "am"}–${e.text}${e.pm ? "pm" : "am"}`;
}

export function formatPrice(type: "fixed" | "from" | "quote", cents: number | null): string {
  if (type === "quote" || cents === null) return "Price on inspection";
  const dollars = cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
  return type === "from" ? `From ${dollars}` : dollars;
}

/** `tel:` link for a display number like '1300 017 205'. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
