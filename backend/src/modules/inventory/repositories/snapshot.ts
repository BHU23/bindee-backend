export const SNAPSHOT_TTL_MS = 20 * 60 * 1000;

export interface SnapshotPrices {
  [flightId: string]: {
    [family: string]: { perAdult: number; perInfant: number };
  };
}

export interface SnapshotData {
  pax: { adults: number; children: number; infants: number };
  prices: SnapshotPrices;
}
