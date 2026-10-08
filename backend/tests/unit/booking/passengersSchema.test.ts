import { describe, expect, it } from "vitest";
import { zodFields } from "@/core/utils/validate.js";
import { savePassengersSchema } from "@/modules/booking/validators/passengers.js";

const passenger = {
  type: "adult",
  title: "Mr",
  firstName: "Somchai",
  lastName: "Jaidee",
  dob: "1990-05-15",
  gender: "M",
  nationality: "TH",
};
const body = {
  passengers: [passenger],
  contact: { name: "Somchai Jaidee", email: "a@b.co", phone: "+66812345678" },
  consent: { privacy: true, marketing: false },
};

function fieldsOf(patch: Record<string, unknown>) {
  const result = savePassengersSchema.safeParse({ ...body, ...patch });
  return result.success ? null : zodFields(result.error);
}
function withPassenger(patch: Record<string, unknown>) {
  return fieldsOf({ passengers: [{ ...passenger, ...patch }] });
}

describe("savePassengersSchema", () => {
  it("When the body is valid, should parse and trim", () => {
    const parsed = savePassengersSchema.parse({
      ...body,
      passengers: [{ ...passenger, firstName: " Somchai ", middleName: "" }],
    });
    expect(parsed.passengers[0]?.firstName).toBe("Somchai");
  });

  it.each(["สมชาย", "John1", "Jo-hn", "   ", ""])(
    "AC-PX-01: When firstName is %j, should flag that field",
    (firstName) => {
      expect(withPassenger({ firstName })).toHaveProperty(
        "passengers.0.firstName",
      );
    },
  );
  it("AC-PX-01: When lastName or middleName is not A-Z, should flag those fields", () => {
    expect(withPassenger({ lastName: "ใจดี" })).toHaveProperty(
      "passengers.0.lastName",
    );
    expect(withPassenger({ middleName: "X1" })).toHaveProperty(
      "passengers.0.middleName",
    );
  });
  it("When names have inner single spaces, should accept them", () => {
    expect(withPassenger({ lastName: "Na Ayutthaya" })).toBeNull();
  });
  it("AC-PX-05: When consent.privacy is false or missing, should flag it", () => {
    expect(
      fieldsOf({ consent: { privacy: false, marketing: false } }),
    ).toHaveProperty("consent.privacy");
    expect(fieldsOf({ consent: { marketing: false } })).toHaveProperty(
      "consent.privacy",
    );
  });
  it.each(["nope", "a@", ""])(
    "AC-PX-07: When email is %j, should flag contact.email",
    (email) => {
      expect(fieldsOf({ contact: { ...body.contact, email } })).toHaveProperty(
        "contact.email",
      );
    },
  );
  it.each(["0812345678", "+0812345678", "+66 81234", "+6681", "+66abc45678"])(
    "AC-PX-07: When phone is %j, should flag contact.phone",
    (phone) => {
      expect(fieldsOf({ contact: { ...body.contact, phone } })).toHaveProperty(
        "contact.phone",
      );
    },
  );
  it("When dob is not a real date, should flag it", () => {
    expect(withPassenger({ dob: "2026-02-30" })).toHaveProperty(
      "passengers.0.dob",
    );
    expect(withPassenger({ dob: "15/05/1990" })).toHaveProperty(
      "passengers.0.dob",
    );
  });
  it("When passengers is empty or a gender is unknown, should reject", () => {
    expect(fieldsOf({ passengers: [] })).toHaveProperty("passengers");
    expect(withPassenger({ gender: "X" })).toHaveProperty(
      "passengers.0.gender",
    );
  });
  it("When passport fields are given in a bad shape, should flag them", () => {
    expect(withPassenger({ passportExpiry: "soon" })).toHaveProperty(
      "passengers.0.passportExpiry",
    );
  });
});
