import {
  NotFoundError,
  SeatUnavailableError,
  ValidationError,
} from "@/core/errors/index.js";
import type { Prisma, PrismaClient } from "@/database/generated/client.js";
import {
  holdRequestSchema,
  SEAT_NO_PATTERN,
} from "@/modules/inventory/validators/holdRequest.js";
import type {
  HoldRequest,
  HoldResult,
} from "@/modules/inventory/types/inventory.js";

type Tx = Prisma.TransactionClient;

interface PlannedItem {
  seatId: string;
  paxIndex: number | null;
}

/** A hold blocks its seats until it is released or its TTL passes. */
export function liveHold(now: Date): Prisma.SeatHoldWhereInput {
  return { releasedAt: null, expiresAt: { gt: now } };
}

/**
 * Serialises holds per flight with row locks, taken in id order to avoid deadlocks.
 * Every availability check below runs after the lock, so it sees committed holds.
 */
async function lockFlights(tx: Tx, flightIds: string[]): Promise<void> {
  const ids = [...new Set(flightIds)].sort();
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM flight WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  if (locked.length !== ids.length) {
    throw new NotFoundError("NOT_FOUND", "Flight not found");
  }
}

async function freeSeatIds(
  tx: Tx,
  now: Date,
  flightId: string,
  limit: number,
  excluded: string[],
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM seat s
    WHERE s.flight_id = ${flightId}
      AND s.status = 'AVAILABLE'
      AND s.id <> ALL(${excluded}::text[])
      AND NOT EXISTS (
        SELECT 1 FROM seat_hold_item i JOIN seat_hold h ON h.id = i.hold_id
        WHERE i.seat_id = s.id AND h.released_at IS NULL AND h.expires_at > ${now}
      )
    ORDER BY s.row, s.letter
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

async function requestedSeats(
  tx: Tx,
  now: Date,
  flightId: string,
  seats: { paxIndex: number; seatNo: string }[],
): Promise<PlannedItem[]> {
  const parsed = seats.map((s) => {
    const match = SEAT_NO_PATTERN.exec(s.seatNo);
    if (!match) throw new ValidationError(`Invalid seat number ${s.seatNo}`);
    return {
      paxIndex: s.paxIndex,
      row: Number(match[1]),
      letter: match[2] as string,
    };
  });
  const found = await tx.seat.findMany({
    where: { flightId, OR: parsed.map(({ row, letter }) => ({ row, letter })) },
    include: {
      holdItems: { where: { hold: liveHold(now) }, select: { id: true } },
    },
  });
  return parsed.map(({ paxIndex, row, letter }) => {
    const seat = found.find((s) => s.row === row && s.letter === letter);
    if (!seat)
      throw new NotFoundError("NOT_FOUND", `Seat ${row}${letter} not found`);
    if (seat.status !== "AVAILABLE" || seat.holdItems.length > 0) {
      throw new SeatUnavailableError();
    }
    return { seatId: seat.id, paxIndex };
  });
}

async function planSegment(
  tx: Tx,
  now: Date,
  segment: HoldRequest["segments"][number],
  paxCount: number,
): Promise<PlannedItem[]> {
  const chosen = await requestedSeats(
    tx,
    now,
    segment.flightId,
    segment.seats ?? [],
  );
  const missing = paxCount - chosen.length;
  const assigned = await freeSeatIds(
    tx,
    now,
    segment.flightId,
    missing,
    chosen.map((c) => c.seatId),
  );
  if (assigned.length < missing) throw new SeatUnavailableError();
  return [...chosen, ...assigned.map((seatId) => ({ seatId, paxIndex: null }))];
}

export async function holdSeats(
  prisma: PrismaClient,
  now: Date,
  request: HoldRequest,
): Promise<HoldResult> {
  const input = holdRequestSchema.parse(request);
  return prisma.$transaction(async (tx) => {
    await lockFlights(
      tx,
      input.segments.map((s) => s.flightId),
    );
    const items: PlannedItem[] = [];
    for (const segment of input.segments) {
      items.push(...(await planSegment(tx, now, segment, input.paxCount)));
    }
    const hold = await tx.seatHold.create({
      data: {
        bookingRef: input.bookingRef,
        createdAt: now,
        expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000),
        items: { create: items },
      },
    });
    return { holdId: hold.id, expiresAt: hold.expiresAt };
  });
}

export async function releaseSeats(
  prisma: PrismaClient,
  now: Date,
  holdId: string,
): Promise<void> {
  const hold = await prisma.seatHold.findUnique({ where: { id: holdId } });
  if (!hold) throw new NotFoundError("NOT_FOUND", "Hold not found");
  await prisma.seatHold.updateMany({
    where: { id: holdId, releasedAt: null },
    data: { releasedAt: now },
  });
}

/** Extends a live hold; otherwise books the same seats again under a new hold. */
export async function extendOrRehold(
  prisma: PrismaClient,
  now: Date,
  holdId: string,
): Promise<HoldResult> {
  return prisma.$transaction(async (tx) => {
    const hold = await tx.seatHold.findUnique({
      where: { id: holdId },
      include: { items: { include: { seat: { select: { flightId: true } } } } },
    });
    if (!hold) throw new NotFoundError("NOT_FOUND", "Hold not found");
    const ttlMs = hold.expiresAt.getTime() - hold.createdAt.getTime();
    await lockFlights(
      tx,
      hold.items.map((i) => i.seat.flightId),
    );

    const stillLive = hold.releasedAt === null && hold.expiresAt > now;
    if (stillLive) {
      const updated = await tx.seatHold.update({
        where: { id: holdId },
        data: { expiresAt: new Date(now.getTime() + ttlMs) },
      });
      return { holdId, expiresAt: updated.expiresAt };
    }

    const seats = await tx.seat.findMany({
      where: { id: { in: hold.items.map((i) => i.seatId) } },
      include: {
        holdItems: { where: { hold: liveHold(now) }, select: { id: true } },
      },
    });
    if (seats.some((s) => s.status !== "AVAILABLE" || s.holdItems.length > 0)) {
      throw new SeatUnavailableError();
    }
    const created = await tx.seatHold.create({
      data: {
        bookingRef: hold.bookingRef,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
        items: {
          create: hold.items.map((i) => ({
            seatId: i.seatId,
            paxIndex: i.paxIndex,
          })),
        },
      },
    });
    return { holdId: created.id, expiresAt: created.expiresAt };
  });
}
