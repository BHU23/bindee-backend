export const DEPARTURE_BANDS = [
  "morning",
  "afternoon",
  "evening",
  "night",
] as const;

export type DepartureBand = (typeof DEPARTURE_BANDS)[number];

/** Band of a UTC instant in the local time of the departure airport. */
export function departureBand(
  departAtIso: string,
  timeZone: string,
): DepartureBand {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(departAtIso)),
  );
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}
