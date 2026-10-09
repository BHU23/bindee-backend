const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SUFFIX_LENGTH = 6;

/** `MOCK-YYYYMMDD-XXXXXX` (UTC date); `randomInt(max)` must return a uniform integer in [0, max). */
export function generateMockRef(
  now: Date,
  randomInt: (max: number) => number,
): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return `MOCK-${date}-${suffix}`;
}
