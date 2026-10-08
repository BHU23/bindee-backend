import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "@/database/seeds/runSeed.js";
import { SEED_DAYS, SEED_NOW, resetInventory } from "../testDb.js";
import { prisma, setup, SESSION_A, SESSION_B, UNKNOWN_ID } from "./harness.js";

beforeAll(async () => {
  await resetInventory(prisma);
  await runSeed(prisma, { now: SEED_NOW, days: SEED_DAYS });
}, 120_000);
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "booking_draft" CASCADE');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const adult = {
  type: "adult",
  title: "Mr",
  firstName: "Somchai",
  lastName: "Jaidee",
  dob: "1990-05-15",
  gender: "M",
  nationality: "TH",
};
const child = {
  type: "child",
  title: "Mstr",
  firstName: "Nong",
  lastName: "Jaidee",
  dob: "2020-01-10",
  gender: "M",
  nationality: "TH",
};
const infant = {
  type: "infant",
  title: "Miss",
  firstName: "Baby",
  lastName: "Jaidee",
  dob: "2026-03-01",
  gender: "F",
  nationality: "TH",
  infantOfPaxIndex: 0,
};
const contact = {
  name: "Somchai Jaidee",
  email: "somchai@example.com",
  phone: "+66812345678",
};
const consent = { privacy: true, marketing: false };

function body(passengers: object[] = [adult], extra: object = {}) {
  return { passengers, contact, consent, ...extra };
}

async function ready(searchOverrides: Record<string, unknown> = {}) {
  const ctx = await setup();
  const searchId = await ctx.createSearch(SESSION_A, searchOverrides);
  const { draftId } = (await ctx.createDraft({ searchId })).json();
  return { ...ctx, draftId };
}

describe("PUT /api/v1/booking-drafts/:draftId/passengers", () => {
  it("When the data is valid, should respond 200 with the saved data and no passport number", async () => {
    const { send, draftId } = await ready();
    const withPassport = {
      ...adult,
      passportNo: "AA1234567",
      passportCountry: "TH",
      passportExpiry: "2030-01-01",
    };

    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([withPassport]),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("AA1234567");
    expect(res.json()).toEqual({
      draftId,
      passengers: [
        {
          type: "adult",
          title: "Mr",
          firstName: "Somchai",
          middleName: null,
          lastName: "Jaidee",
          dob: "1990-05-15",
          gender: "M",
          nationality: "TH",
          passportCountry: "TH",
          passportExpiry: "2030-01-01",
          infantOfPaxIndex: null,
          hasPassport: true,
        },
      ],
      contact,
      consent,
    });
    const rows = await prisma.passenger.findMany({ where: { draftId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ position: 0, passportNo: "AA1234567" });
  });

  it("AC-PX-01: When a name has non A-Z characters, should respond 400 on that field", async () => {
    const { send, draftId } = await ready();
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([{ ...adult, firstName: "สมชาย" }]),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.fields).toHaveProperty("passengers.0.firstName");
  });

  it("AC-PX-02: When the age on the travel date does not match the type, should respond 400 PAX_TYPE_AGE_MISMATCH", async () => {
    const { send, draftId } = await ready();
    // Turns 12 the day after the travel date (2026-10-08).
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([{ ...adult, dob: "2014-10-09" }]),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("PAX_TYPE_AGE_MISMATCH");
    expect(res.json().error.fields).toHaveProperty("passengers.0.dob");
  });

  it("AC-PX-02: When an adult turns 12 on the travel date, should accept", async () => {
    const { send, draftId } = await ready();
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([{ ...adult, dob: "2014-10-08" }]),
    );
    expect(res.statusCode).toBe(200);
  });

  it("AC-PX-02: When the date of birth is after the travel date, should respond 400 PAX_TYPE_AGE_MISMATCH", async () => {
    const { send, draftId } = await ready();
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([{ ...adult, dob: "2026-10-09" }]),
    );
    expect(res.json().error.code).toBe("PAX_TYPE_AGE_MISMATCH");
  });

  it("AC-PX-02: When 2 adults, 1 child and 1 infant match their ages, should save all four in order", async () => {
    const { send, draftId } = await ready({
      adults: 2,
      children: 1,
      infants: 1,
    });
    const second = {
      ...adult,
      firstName: "Somying",
      title: "Mrs",
      gender: "F",
    };
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([adult, second, child, infant]),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().passengers.map((p: { type: string }) => p.type)).toEqual([
      "adult",
      "adult",
      "child",
      "infant",
    ]);
  });

  it("AC-PX-05: When consent.privacy is false, should respond 400 and save nothing", async () => {
    const { send, draftId } = await ready();
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([adult], { consent: { privacy: false, marketing: false } }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toHaveProperty("consent.privacy");
    expect(await prisma.passenger.count()).toBe(0);
  });

  it("AC-PX-06: When the counts differ from the search, should respond 400 PAX_COUNT_MISMATCH", async () => {
    const { send, draftId } = await ready();
    const tooMany = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([adult, child]),
    );
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe("PAX_COUNT_MISMATCH");

    const wrongType = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([child]),
    );
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json().error.code).toBe("PAX_COUNT_MISMATCH");
  });

  it("AC-PX-07: When the email or phone is invalid, should respond 400 on contact fields", async () => {
    const { send, draftId } = await ready();
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([adult], { contact: { ...contact, email: "nope", phone: "081" } }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toHaveProperty("contact.email");
    expect(res.json().error.fields).toHaveProperty("contact.phone");
  });

  it("AC-PX-08: When saved twice, should overwrite the first save", async () => {
    const { send, draftId } = await ready();
    await send("PUT", `/${draftId}/passengers`, body());
    const second = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([{ ...adult, firstName: "Somsak" }], {
        contact: { ...contact, name: "Somsak" },
        consent: { privacy: true, marketing: true },
      }),
    );
    expect(second.statusCode).toBe(200);
    const rows = await prisma.passenger.findMany({ where: { draftId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.firstName).toBe("Somsak");
    const draft = await prisma.bookingDraft.findUniqueOrThrow({
      where: { id: draftId },
    });
    expect(draft).toMatchObject({
      contactName: "Somsak",
      consentMarketing: true,
    });
  });

  it("AC-PX-09: When the title is not allowed for the type, should respond 400 TITLE_NOT_ALLOWED_FOR_TYPE", async () => {
    const { send, draftId } = await ready();
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([{ ...adult, title: "Mstr" }]),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("TITLE_NOT_ALLOWED_FOR_TYPE");
    expect(res.json().error.fields).toHaveProperty("passengers.0.title");
  });

  it("AC-PX-10: When the gender disagrees with the title, should respond 400 TITLE_GENDER_MISMATCH", async () => {
    const { send, draftId } = await ready();
    const res = await send(
      "PUT",
      `/${draftId}/passengers`,
      body([{ ...adult, gender: "F" }]),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("TITLE_GENDER_MISMATCH");
    expect(res.json().error.fields).toHaveProperty("passengers.0.gender");
  });

  it("When the draft does not exist, should respond 404 DRAFT_NOT_FOUND", async () => {
    const { send } = await ready();
    const res = await send("PUT", `/${UNKNOWN_ID}/passengers`, body());
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("DRAFT_NOT_FOUND");
  });

  it("When the draft belongs to another session, should respond 404", async () => {
    const { send, draftId } = await ready();
    const res = await send("PUT", `/${draftId}/passengers`, body(), SESSION_B);
    expect(res.statusCode).toBe(404);
  });

  it("When the session header is missing or the draftId is not a uuid, should respond 400", async () => {
    const { send, draftId } = await ready();
    expect(
      (await send("PUT", `/${draftId}/passengers`, body(), null)).statusCode,
    ).toBe(400);
    expect((await send("PUT", "/nope/passengers", body())).statusCode).toBe(
      400,
    );
  });

  it("When the draft has expired, should respond 410 SEARCH_EXPIRED", async () => {
    const { send, draftId, clock } = await ready();
    await clock.advance(21 * 60 * 1000);
    const res = await send("PUT", `/${draftId}/passengers`, body());
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("SEARCH_EXPIRED");
  });
});

describe("GET /api/v1/booking-drafts/:draftId/passengers", () => {
  it("AC-PX-11: When passengers were saved, should return them with contact and consent but no passport number", async () => {
    const { send, draftId } = await ready({ adults: 1, children: 1 });
    const saved = [
      { ...adult, passportNo: "AA1234567", middleName: "Q" },
      child,
    ];
    await send("PUT", `/${draftId}/passengers`, body(saved));

    const res = await send("GET", `/${draftId}/passengers`);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("AA1234567");
    const json = res.json();
    expect(json.passengers).toHaveLength(2);
    expect(json.passengers[0]).toMatchObject({
      firstName: "Somchai",
      middleName: "Q",
      hasPassport: true,
    });
    expect(json.passengers[1]).toMatchObject({
      type: "child",
      hasPassport: false,
    });
    expect(json.contact).toEqual(contact);
    expect(json.consent).toEqual(consent);
  });

  it("AC-PX-11: When nothing was saved, should return an empty passenger list", async () => {
    const { send, draftId } = await ready();
    const res = await send("GET", `/${draftId}/passengers`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      draftId,
      passengers: [],
      contact: null,
      consent: null,
    });
  });

  it("AC-PX-11: When the draft belongs to another session, should respond 404", async () => {
    const { send, draftId } = await ready();
    await send("PUT", `/${draftId}/passengers`, body());
    const res = await send(
      "GET",
      `/${draftId}/passengers`,
      undefined,
      SESSION_B,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("DRAFT_NOT_FOUND");
  });

  it("When the draft has expired, should respond 410 SEARCH_EXPIRED", async () => {
    const { send, draftId, clock } = await ready();
    await clock.advance(21 * 60 * 1000);
    const res = await send("GET", `/${draftId}/passengers`);
    expect(res.statusCode).toBe(410);
  });
});
