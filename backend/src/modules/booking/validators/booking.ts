import { z } from "zod";

export const pnrParamsSchema = z.object({
  pnr: z.string().regex(/^[A-Z0-9]{6}$/),
});
