import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { ZodError } from "zod";
import { AppError, SearchExpiredError } from "@/core/errors/index.js";
import { zodFields } from "@/core/utils/validate.js";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    query?: object;
  };
}

function send(reply: FastifyReply, status: number, error: ErrorBody["error"]) {
  return reply.status(status).send({ error } satisfies ErrorBody);
}

function handleError(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AppError) {
    return send(reply, error.status, {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
      ...(error instanceof SearchExpiredError && error.query
        ? { query: error.query }
        : {}),
    });
  }
  if (error instanceof ZodError) {
    return send(reply, 400, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      fields: zodFields(error),
    });
  }
  const statusCode = (error as FastifyError).statusCode;
  if (statusCode === 400) {
    return send(reply, 400, {
      code: "VALIDATION_ERROR",
      message: "Malformed request",
    });
  }
  request.log.error({ err: error }, "unhandled error");
  return send(reply, 500, {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(handleError);
  app.setNotFoundHandler((_request, reply) =>
    send(reply, 404, { code: "NOT_FOUND", message: "Route not found" }),
  );
}
