import type { z } from "zod";
import { ValidationError, type ErrorFields } from "@/core/errors/index.js";

export function zodFields(error: z.ZodError): ErrorFields {
  const fields: ErrorFields = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

export function validate<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(undefined, zodFields(result.error));
  }
  return result.data;
}
