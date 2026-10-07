import { describe, expect, it } from "vitest";
import {
  InventoryUnavailableError,
  SearchExpiredError,
  SeatUnavailableError,
} from "../../../src/core/errors/index.js";

describe("inventory errors", () => {
  it("When SeatUnavailableError is created, should be 409 SEAT_UNAVAILABLE", () => {
    const error = new SeatUnavailableError();
    expect([error.status, error.code]).toEqual([409, "SEAT_UNAVAILABLE"]);
  });

  it("AC-INV-05 When SearchExpiredError is created, should be 410 SEARCH_EXPIRED", () => {
    const error = new SearchExpiredError();
    expect([error.status, error.code]).toEqual([410, "SEARCH_EXPIRED"]);
  });

  it("When InventoryUnavailableError is created, should be 503 INVENTORY_UNAVAILABLE", () => {
    const error = new InventoryUnavailableError();
    expect([error.status, error.code]).toEqual([503, "INVENTORY_UNAVAILABLE"]);
  });
});
