import { z } from "zod";

const NAME_PATTERN = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const MAX_PASSENGERS = 9;
const NAME_MESSAGE = "Use letters A-Z only, as on the passport";

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const nameSchema = z.string().trim().regex(NAME_PATTERN, NAME_MESSAGE);
const dateSchema = z
  .string()
  .refine(isRealDate, "Use a real date in YYYY-MM-DD format");
const textSchema = z.string().trim().min(1).max(60);

const passengerSchema = z.object({
  type: z.enum(["adult", "child", "infant"]),
  title: z.enum(["Mr", "Mrs", "Ms", "Miss", "Mstr"]),
  firstName: nameSchema,
  middleName: z.union([z.literal(""), nameSchema]).optional(),
  lastName: nameSchema,
  dob: dateSchema,
  gender: z.enum(["M", "F"]),
  nationality: textSchema,
  passportNo: z.string().trim().min(1).max(20).optional(),
  passportCountry: textSchema.optional(),
  passportExpiry: dateSchema.optional(),
  infantOfPaxIndex: z.number().int().min(0).optional(),
});

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  phone: z
    .string()
    .regex(PHONE_PATTERN, "Use international format, e.g. +66812345678"),
});

const consentSchema = z.object({
  privacy: z.literal(true, "Privacy consent is required"),
  marketing: z.boolean(),
});

export const savePassengersSchema = z.object({
  passengers: z.array(passengerSchema).min(1).max(MAX_PASSENGERS),
  contact: contactSchema,
  consent: consentSchema,
});

export type SavePassengersInput = z.infer<typeof savePassengersSchema>;
