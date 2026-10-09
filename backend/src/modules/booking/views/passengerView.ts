import type {
  PassengerDto,
  PassengerRecord,
  PassengersResponse,
  SavedPassengers,
} from "../types/passenger.js";

/** Drops the passport number: only `hasPassport` leaves the server. */
function passengerView(record: PassengerRecord): PassengerDto {
  return {
    type: record.type,
    title: record.title,
    firstName: record.firstName,
    middleName: record.middleName,
    lastName: record.lastName,
    dob: record.dob,
    gender: record.gender,
    nationality: record.nationality,
    passportCountry: record.passportCountry,
    passportExpiry: record.passportExpiry,
    infantOfPaxIndex: record.infantOfPaxIndex,
    hasPassport: record.passportNo !== null,
  };
}

export function passengersView(
  draftId: string,
  saved: SavedPassengers,
): PassengersResponse {
  return {
    draftId,
    passengers: saved.passengers.map(passengerView),
    contact: saved.contact,
    consent: saved.consent,
  };
}
