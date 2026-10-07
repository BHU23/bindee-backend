import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
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
