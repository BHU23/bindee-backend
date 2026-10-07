const BANGKOK_OFFSET = "+07:00";
const DAY_MS = 86_400_000;

/** Start (inclusive) and end (exclusive) of a Bangkok calendar day, YYYY-MM-DD. */
export function bangkokDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00${BANGKOK_OFFSET}`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS;
  return new Date(shifted).toISOString().slice(0, 10);
}
