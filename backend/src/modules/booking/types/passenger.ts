export type PassengerType = "adult" | "child" | "infant";
export type PassengerTitle = "Mr" | "Mrs" | "Ms" | "Miss" | "Mstr";
export type PassengerGender = "M" | "F";

export interface PassengerInput {
  type: PassengerType;
  title: PassengerTitle;
  firstName: string;
  middleName?: string | undefined;
  lastName: string;
  dob: string;
  gender: PassengerGender;
  nationality: string;
  passportNo?: string | undefined;
  passportCountry?: string | undefined;
  passportExpiry?: string | undefined;
  infantOfPaxIndex?: number | undefined;
}

export interface ContactInfo {
  name: string;
  email: string;
  phone: string;
}

export interface ConsentInfo {
  privacy: boolean;
  marketing: boolean;
}

/** A stored passenger; nullable columns are `null`, not optional. */
export interface PassengerRecord {
  type: PassengerType;
  title: PassengerTitle;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dob: string;
  gender: PassengerGender;
  nationality: string;
  passportNo: string | null;
  passportCountry: string | null;
  passportExpiry: string | null;
  infantOfPaxIndex: number | null;
}

export interface SavedPassengers {
  passengers: PassengerRecord[];
  contact: ContactInfo | null;
  consent: ConsentInfo | null;
}

/** Wire shape: the passport number is never returned, only whether one is stored. */
export interface PassengerDto {
  type: PassengerType;
  title: PassengerTitle;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dob: string;
  gender: PassengerGender;
  nationality: string;
  passportCountry: string | null;
  passportExpiry: string | null;
  infantOfPaxIndex: number | null;
  hasPassport: boolean;
}

export interface PassengersResponse {
  draftId: string;
  passengers: PassengerDto[];
  contact: ContactInfo | null;
  consent: ConsentInfo | null;
}
