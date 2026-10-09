export const PNR_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const PNR_LENGTH = 6;

/** `randomInt(max)` must return a uniform integer in [0, max); each character is an independent draw. */
export function generatePnr(randomInt: (max: number) => number): string {
  let pnr = "";
  for (let i = 0; i < PNR_LENGTH; i++) {
    pnr += PNR_ALPHABET.charAt(randomInt(PNR_ALPHABET.length));
  }
  return pnr;
}
