import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** Flight number whose next reprice returns a changed price (HS-1 demo/test trigger). */
  INVENTORY_FORCE_PRICE_CHANGE: z.string().min(1).optional(),
  /** Seconds after holdExpiresAt during which a payment started before expiry still completes normally (AC-MP-06). */
  /** Shared secret for POST /mock-payment/callback (X-Callback-Secret); unset leaves the webhook open. */
  MOCK_CALLBACK_SECRET: z.string().min(16).optional(),
  HOLD_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(60),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
