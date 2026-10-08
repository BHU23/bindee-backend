import type { FastifyInstance } from "fastify";
import { createBookingController } from "../controllers/bookingController.js";
import type { BookingService } from "../services/bookingService.js";

export function bookingRoutes(service: BookingService) {
  const controller = createBookingController(service);
  return async function bookingPlugin(app: FastifyInstance): Promise<void> {
    app.post("/booking-drafts", controller.createDraft);
    app.get(
      "/booking-drafts/:draftId/flights/:flightId/fares",
      controller.getFares,
    );
    app.put(
      "/booking-drafts/:draftId/outbound",
      controller.selectFare("outbound"),
    );
    app.post(
      "/booking-drafts/:draftId/outbound/accept-price",
      controller.acceptPrice("outbound"),
    );
    app.put("/booking-drafts/:draftId/return", controller.selectFare("return"));
    app.post(
      "/booking-drafts/:draftId/return/accept-price",
      controller.acceptPrice("return"),
    );
    app.put("/booking-drafts/:draftId/passengers", controller.savePassengers);
    app.get("/booking-drafts/:draftId/passengers", controller.getPassengers);
    app.get(
      "/booking-drafts/:draftId/return-flights",
      controller.listReturnFlights,
    );
  };
}
