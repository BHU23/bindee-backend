import type {
  PassengerGender,
  PassengerTitle,
  PassengerType,
} from "../types/passenger.js";

const TITLE_GENDER: Record<PassengerTitle, PassengerGender> = {
  Mr: "M",
  Mrs: "F",
  Ms: "F",
  Miss: "F",
  Mstr: "M",
};

const TITLES_BY_TYPE: Record<PassengerType, readonly PassengerTitle[]> = {
  adult: ["Mr", "Mrs", "Ms", "Miss"],
  child: ["Mstr", "Miss"],
  infant: ["Mstr", "Miss"],
};

const ADULT_MIN_AGE = 12;
const CHILD_MIN_AGE = 2;

export function isTitleAllowed(
  type: PassengerType,
  title: PassengerTitle,
): boolean {
  return TITLES_BY_TYPE[type].includes(title);
}

export function titleGender(title: PassengerTitle): PassengerGender {
  return TITLE_GENDER[title];
}

/** Whole years between two `YYYY-MM-DD` dates (birthday counts from its own day). Negative when dob is later. */
export function ageOn(dob: string, onDate: string): number {
  const [by = 0, bm = 0, bd = 0] = dob.split("-").map(Number);
  const [ty = 0, tm = 0, td = 0] = onDate.split("-").map(Number);
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

/** The passenger type an age belongs to, or null for a birth date after the travel date. */
export function typeForAge(age: number): PassengerType | null {
  if (age < 0) return null;
  if (age >= ADULT_MIN_AGE) return "adult";
  return age >= CHILD_MIN_AGE ? "child" : "infant";
}
