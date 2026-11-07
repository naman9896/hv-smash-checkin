// Calendar-date helpers. Drop-off days are Sydney dates (BUSINESS_RULES §1).

/** Today's date in Australia/Sydney, 'YYYY-MM-DD'. */
export function sydneyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(now);
}

/** Pure calendar arithmetic on 'YYYY-MM-DD' (no time zones, no DST). */
export function addDaysIso(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
