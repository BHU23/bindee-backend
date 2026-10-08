import type { FastifyInstance } from "fastify";
import { createBookingController } from "../controllers/bookingController.js";
import type { BookingService } from "../services/bookingService.js";

export function bookingRoutes(service: BookingService) {
  const controller = createBookingController(service);
  return async function bookingPlugin(app: FastifyInstance): Promise<void> {
    app.post("/booking-drafts", controller.createDraft);
    app.put("/booking-drafts/:draftId/outbound", controller.selectOutbound);
  };
}
