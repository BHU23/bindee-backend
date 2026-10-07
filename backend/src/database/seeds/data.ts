export type FareFamilyName = "LITE" | "VALUE" | "FLEX";
export type SeatKindName = "WINDOW" | "MIDDLE" | "AISLE" | "EXIT";
export type AircraftName = "A320" | "A321neo";

export const BANGKOK_UTC_OFFSET_HOURS = 7;
export const SEED_DAYS = 120;
export const SOLD_OUT_DAY_OFFSET = 9;
export const SPECIAL_LAST_SEAT_FLIGHT = "BN 199";
export const REPRICE_TRIGGER_FLIGHT = "BN 101";

export const AIRPORTS = [
  { code: "BKK", name: "Suvarnabhumi Airport", city: "Bangkok" },
  { code: "DMK", name: "Don Mueang International Airport", city: "Bangkok" },
  { code: "CNX", name: "Chiang Mai International Airport", city: "Chiang Mai" },
  { code: "HKT", name: "Phuket International Airport", city: "Phuket" },
  { code: "HDY", name: "Hat Yai International Airport", city: "Hat Yai" },
  { code: "SIN", name: "Singapore Changi Airport", city: "Singapore" },
  { code: "NRT", name: "Narita International Airport", city: "Tokyo" },
] as const;

interface RouteConfig {
  origin: string;
  destination: string;
  international: boolean;
  durationMinutes: number;
  flightsPerDay: number;
  baseFare: Record<FareFamilyName, number>;
  airportTax: number;
  fuelSurcharge: number;
  serviceFee: number;
  outboundNumbers: string[];
  returnNumbers: string[];
}

/** One entry per route pair; both directions are generated from it. */
export const ROUTE_CONFIGS: RouteConfig[] = [
  {
    origin: "BKK",
    destination: "CNX",
    international: false,
    durationMinutes: 70,
    flightsPerDay: 4,
    baseFare: { LITE: 690, VALUE: 1090, FLEX: 1590 },
    airportTax: 100,
    fuelSurcharge: 150,
    serviceFee: 50,
    outboundNumbers: ["BN 101", "BN 102", "BN 103", SPECIAL_LAST_SEAT_FLIGHT],
    returnNumbers: ["BN 111", "BN 112", "BN 113", "BN 114"],
  },
  {
    origin: "BKK",
    destination: "HKT",
    international: false,
    durationMinutes: 85,
    flightsPerDay: 3,
    baseFare: { LITE: 790, VALUE: 1190, FLEX: 1790 },
    airportTax: 100,
    fuelSurcharge: 200,
    serviceFee: 50,
    outboundNumbers: ["BN 201", "BN 202", "BN 203"],
    returnNumbers: ["BN 211", "BN 212", "BN 213"],
  },
  {
    origin: "DMK",
    destination: "HDY",
    international: false,
    durationMinutes: 85,
    flightsPerDay: 2,
    baseFare: { LITE: 740, VALUE: 1140, FLEX: 1640 },
    airportTax: 100,
    fuelSurcharge: 200,
    serviceFee: 50,
    outboundNumbers: ["BN 301", "BN 302"],
    returnNumbers: ["BN 311", "BN 312"],
  },
  {
    origin: "BKK",
    destination: "SIN",
    international: true,
    durationMinutes: 145,
    flightsPerDay: 2,
    baseFare: { LITE: 2290, VALUE: 2990, FLEX: 4190 },
    airportTax: 700,
    fuelSurcharge: 450,
    serviceFee: 100,
    outboundNumbers: ["BN 401", "BN 402"],
    returnNumbers: ["BN 411", "BN 412"],
  },
  {
    origin: "BKK",
    destination: "NRT",
    international: true,
    durationMinutes: 365,
    flightsPerDay: 1,
    baseFare: { LITE: 7490, VALUE: 8990, FLEX: 11990 },
    airportTax: 700,
    fuelSurcharge: 1200,
    serviceFee: 100,
    outboundNumbers: ["BN 501"],
    returnNumbers: ["BN 511"],
  },
];

const DEPARTURE_HOURS: Record<number, number[]> = {
  1: [9],
  2: [8, 18],
  3: [7, 12, 19],
  4: [6, 10, 14, 18],
};

/** Midday is cheaper, evening dearer; range 0.90–1.20, 1.00 for the early flight. */
export function priceFactorForHour(hour: number): number {
  if (hour < 10) return 1.0;
  if (hour < 15) return 0.9;
  if (hour < 17) return 1.05;
  return 1.2;
}

export const FARE_RULES: Record<
  FareFamilyName,
  {
    checkedBagKg: number;
    changeAllowed: boolean;
    changeFee: number;
    refundAllowed: boolean;
    refundFee: number;
    seatIncluded: boolean;
  }
> = {
  LITE: {
    checkedBagKg: 0,
    changeAllowed: false,
    changeFee: 0,
    refundAllowed: false,
    refundFee: 0,
    seatIncluded: false,
  },
  VALUE: {
    checkedBagKg: 20,
    changeAllowed: true,
    changeFee: 500,
    refundAllowed: false,
    refundFee: 0,
    seatIncluded: false,
  },
  FLEX: {
    checkedBagKg: 30,
    changeAllowed: true,
    changeFee: 0,
    refundAllowed: true,
    refundFee: 500,
    seatIncluded: true,
  },
};

export const FARE_FAMILIES: FareFamilyName[] = ["LITE", "VALUE", "FLEX"];

export interface FarePlan {
  family: FareFamilyName;
  basePrice: number;
  airportTax: number;
  fuelSurcharge: number;
  serviceFee: number;
  cabinBagKg: number;
  checkedBagKg: number;
  changeAllowed: boolean;
  changeFee: number;
  refundAllowed: boolean;
  refundFee: number;
  seatIncluded: boolean;
  repriceTrigger: boolean;
}

export interface FlightPlan {
  flightNo: string;
  origin: string;
  destination: string;
  departAt: Date;
  arriveAt: Date;
  aircraft: AircraftName;
  international: boolean;
  priceFactor: number;
  fares: FarePlan[];
  /** Every seat sold for this flight. */
  soldOut: boolean;
  /** Seats left available when the flight is nearly full (all others sold). */
  seatsLeft?: number;
}

export interface RoutePlan {
  origin: string;
  destination: string;
  international: boolean;
  durationMinutes: number;
}

export function buildRoutePlans(): RoutePlan[] {
  return ROUTE_CONFIGS.flatMap((c) => [
    {
      origin: c.origin,
      destination: c.destination,
      international: c.international,
      durationMinutes: c.durationMinutes,
    },
    {
      origin: c.destination,
      destination: c.origin,
      international: c.international,
      durationMinutes: c.durationMinutes,
    },
  ]);
}

/** Midnight (00:00, Bangkok time) of the run date, as an absolute instant. */
export function bangkokMidnight(now: Date): Date {
  const local = new Date(now.getTime() + BANGKOK_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      -BANGKOK_UTC_OFFSET_HOURS,
    ),
  );
}

function buildFares(config: RouteConfig, flightNo: string): FarePlan[] {
  return FARE_FAMILIES.map((family) => ({
    family,
    basePrice: config.baseFare[family],
    airportTax: config.airportTax,
    fuelSurcharge: config.fuelSurcharge,
    serviceFee: config.serviceFee,
    cabinBagKg: 7,
    ...FARE_RULES[family],
    repriceTrigger: flightNo === REPRICE_TRIGGER_FLIGHT && family === "VALUE",
  }));
}

export function buildFlightPlans(
  now: Date,
  days: number = SEED_DAYS,
): FlightPlan[] {
  const midnight = bangkokMidnight(now);
  const plans: FlightPlan[] = [];
  for (let day = 0; day < days; day++) {
    for (const config of ROUTE_CONFIGS) {
      const hours = DEPARTURE_HOURS[config.flightsPerDay] ?? [9];
      const directions = [
        {
          origin: config.origin,
          destination: config.destination,
          numbers: config.outboundNumbers,
        },
        {
          origin: config.destination,
          destination: config.origin,
          numbers: config.returnNumbers,
        },
      ];
      for (const direction of directions) {
        direction.numbers.forEach((flightNo, index) => {
          const hour = hours[index] ?? 9;
          const departAt = new Date(
            midnight.getTime() + day * 86_400_000 + hour * 3_600_000,
          );
          const isCnxOutbound =
            config.origin === "BKK" &&
            config.destination === "CNX" &&
            direction.origin === "BKK";
          plans.push({
            flightNo,
            origin: direction.origin,
            destination: direction.destination,
            departAt,
            arriveAt: new Date(
              departAt.getTime() + config.durationMinutes * 60_000,
            ),
            aircraft: config.international ? "A321neo" : "A320",
            international: config.international,
            priceFactor: priceFactorForHour(hour),
            fares: buildFares(config, flightNo),
            soldOut: isCnxOutbound && day === SOLD_OUT_DAY_OFFSET,
            seatsLeft: flightNo === SPECIAL_LAST_SEAT_FLIGHT ? 1 : undefined,
          });
        });
      }
    }
  }
  return plans;
}

interface AircraftLayout {
  rows: number;
  exitRows: number[];
  prices: { standard: number; front: number; exit: number };
}

export const AIRCRAFT_LAYOUTS: Record<AircraftName, AircraftLayout> = {
  A320: {
    rows: 30,
    exitRows: [12, 13],
    prices: { standard: 100, front: 200, exit: 300 },
  },
  A321neo: {
    rows: 33,
    exitRows: [14, 15],
    prices: { standard: 250, front: 450, exit: 600 },
  },
};

export const SEAT_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export const FRONT_ROW_MAX = 3;

export interface SeatPlan {
  row: number;
  letter: string;
  kind: SeatKindName;
  price: number;
}

export function seatKindFor(letter: string, isExitRow: boolean): SeatKindName {
  if (isExitRow) return "EXIT";
  if (letter === "A" || letter === "F") return "WINDOW";
  if (letter === "C" || letter === "D") return "AISLE";
  return "MIDDLE";
}

export function buildSeatPlans(aircraft: AircraftName): SeatPlan[] {
  const layout = AIRCRAFT_LAYOUTS[aircraft];
  const seats: SeatPlan[] = [];
  for (let row = 1; row <= layout.rows; row++) {
    const isExit = layout.exitRows.includes(row);
    const price = isExit
      ? layout.prices.exit
      : row <= FRONT_ROW_MAX
        ? layout.prices.front
        : layout.prices.standard;
    for (const letter of SEAT_LETTERS) {
      seats.push({ row, letter, kind: seatKindFor(letter, isExit), price });
    }
  }
  return seats;
}

export const PROMO_CODES = [
  {
    code: "BINDEE10",
    discountType: "PERCENT",
    value: 10,
    validUntil: new Date("2026-12-31T16:59:59.999Z"),
    minBaseFare: 1000,
    domesticOnly: false,
  },
  {
    code: "FLYDEE100",
    discountType: "FIXED_PER_PAX",
    value: 100,
    validUntil: new Date("2026-11-30T16:59:59.999Z"),
    minBaseFare: 1500,
    domesticOnly: true,
  },
  {
    code: "SUMMER50",
    discountType: "FIXED_PER_PAX",
    value: 50,
    validUntil: new Date("2026-06-30T16:59:59.999Z"),
    minBaseFare: 0,
    domesticOnly: false,
  },
] as const;

export const ADDON_PRICES = [
  {
    category: "BAGGAGE",
    code: "15",
    label: "Checked baggage 15 kg",
    priceDomestic: 350,
    priceInternational: 700,
  },
  {
    category: "BAGGAGE",
    code: "20",
    label: "Checked baggage 20 kg",
    priceDomestic: 450,
    priceInternational: 900,
  },
  {
    category: "BAGGAGE",
    code: "25",
    label: "Checked baggage 25 kg",
    priceDomestic: 600,
    priceInternational: 1200,
  },
  {
    category: "BAGGAGE",
    code: "30",
    label: "Checked baggage 30 kg",
    priceDomestic: 750,
    priceInternational: 1500,
  },
  {
    category: "MEAL",
    code: "CHICKEN_RICE",
    label: "ข้าวมันไก่",
    priceDomestic: 150,
    priceInternational: 210,
  },
  {
    category: "MEAL",
    code: "BASIL_CHICKEN_EGG",
    label: "ข้าวกะเพราไก่ไข่ดาว",
    priceDomestic: 160,
    priceInternational: 220,
  },
  {
    category: "MEAL",
    code: "SPAGHETTI_CREAM",
    label: "สปาเกตตี้ครีมซอส",
    priceDomestic: 170,
    priceInternational: 230,
  },
  {
    category: "MEAL",
    code: "VEGETARIAN",
    label: "อาหารมังสวิรัติ",
    priceDomestic: 160,
    priceInternational: 220,
  },
  {
    category: "INSURANCE",
    code: "TRAVEL",
    label: "Travel insurance",
    priceDomestic: 99,
    priceInternational: 299,
  },
  {
    category: "ASSISTANCE",
    code: "WHEELCHAIR",
    label: "Wheelchair assistance",
    priceDomestic: 0,
    priceInternational: 0,
  },
  {
    category: "ASSISTANCE",
    code: "PREGNANCY",
    label: "Pregnancy assistance",
    priceDomestic: 0,
    priceInternational: 0,
  },
] as const;
