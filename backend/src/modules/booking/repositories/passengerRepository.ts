import type { PrismaClient } from "@/database/generated/client.js";
import type {
  ConsentInfo,
  ContactInfo,
  PassengerInput,
  PassengerRecord,
  SavedPassengers,
} from "../types/passenger.js";

export interface PassengerRepository {
  /** Atomically swaps the whole passenger list, contact and consent of a draft. */
  replacePassengers(
    draftId: string,
    passengers: PassengerInput[],
    contact: ContactInfo,
    consent: ConsentInfo,
  ): Promise<void>;
  findByDraft(draftId: string): Promise<SavedPassengers>;
}

export function createPassengerRepository(
  prisma: PrismaClient,
): PassengerRepository {
  return {
    async replacePassengers(draftId, passengers, contact, consent) {
      await prisma.$transaction([
        prisma.passenger.deleteMany({ where: { draftId } }),
        prisma.passenger.createMany({
          data: passengers.map((p, position) => ({
            draftId,
            position,
            type: p.type,
            title: p.title,
            firstName: p.firstName,
            middleName: p.middleName || null,
            lastName: p.lastName,
            dob: p.dob,
            gender: p.gender,
            nationality: p.nationality,
            passportNo: p.passportNo ?? null,
            passportCountry: p.passportCountry ?? null,
            passportExpiry: p.passportExpiry ?? null,
            infantOfPaxIndex: p.infantOfPaxIndex ?? null,
          })),
        }),
        prisma.bookingDraft.update({
          where: { id: draftId },
          data: {
            contactName: contact.name,
            contactEmail: contact.email,
            contactPhone: contact.phone,
            consentPrivacy: consent.privacy,
            consentMarketing: consent.marketing,
          },
        }),
      ]);
    },
    async findByDraft(draftId) {
      const draft = await prisma.bookingDraft.findUnique({
        where: { id: draftId },
        select: {
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          consentPrivacy: true,
          consentMarketing: true,
          passengers: { orderBy: { position: "asc" } },
        },
      });
      if (!draft) return { passengers: [], contact: null, consent: null };
      const hasContact =
        draft.contactName !== null &&
        draft.contactEmail !== null &&
        draft.contactPhone !== null;
      return {
        passengers: draft.passengers.map((row): PassengerRecord => ({
          type: row.type as PassengerRecord["type"],
          title: row.title as PassengerRecord["title"],
          firstName: row.firstName,
          middleName: row.middleName,
          lastName: row.lastName,
          dob: row.dob,
          gender: row.gender as PassengerRecord["gender"],
          nationality: row.nationality,
          passportNo: row.passportNo,
          passportCountry: row.passportCountry,
          passportExpiry: row.passportExpiry,
          infantOfPaxIndex: row.infantOfPaxIndex,
        })),
        contact: hasContact
          ? {
              name: draft.contactName ?? "",
              email: draft.contactEmail ?? "",
              phone: draft.contactPhone ?? "",
            }
          : null,
        consent:
          draft.consentPrivacy !== null && draft.consentMarketing !== null
            ? {
                privacy: draft.consentPrivacy,
                marketing: draft.consentMarketing,
              }
            : null,
      };
    },
  };
}
