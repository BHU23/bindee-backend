const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** Bangkok calendar day (YYYY-MM-DD) of an epoch-ms instant. */
export function bangkokToday(nowMs: number): string {
  return new Date(nowMs + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const shifted = new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** True for a YYYY-MM-DD string that is a real calendar day. */
export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day)
  );
}
