import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ValidationIssue {
  instancePath?: string;
  keyword?: string;
  message?: string;
}

function validationDetails(error: FastifyError): unknown {
  const issues = error.validation as ValidationIssue[] | undefined;
  if (!issues) return undefined;

  return {
    context: error.validationContext,
    issues: issues.map(({ instancePath, keyword, message }) => ({
      path: instancePath ?? "",
      keyword,
      message,
    })),
  };
}

function errorBody(
  request: FastifyRequest,
  code: string,
  message: string,
  details?: unknown,
) {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      traceId: request.id,
    },
  };
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    return reply
      .code(404)
      .send(errorBody(request, "NOT_FOUND", "请求的资源不存在"));
  });

  app.setErrorHandler((error, request, reply) => {
    const fastifyError = error as FastifyError;

    if (fastifyError.validation) {
      return reply
        .code(400)
        .send(
          errorBody(
            request,
            "VALIDATION_ERROR",
            "请求参数校验失败",
            validationDetails(fastifyError),
          ),
        );
    }

    if (error instanceof ApiError) {
      return reply
        .code(error.statusCode)
        .send(errorBody(request, error.code, error.message, error.details));
    }

    const candidateStatusCode: unknown = (
      fastifyError as { statusCode?: unknown }
    ).statusCode;
    const statusCode =
      typeof candidateStatusCode === "number" && candidateStatusCode >= 400
        ? candidateStatusCode
        : 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      request.log.error({ err: error }, "Unhandled request error");
    }

    return reply
      .code(statusCode)
      .send(
        errorBody(
          request,
          isServerError ? "INTERNAL_ERROR" : "REQUEST_ERROR",
          isServerError ? "服务器内部错误" : "请求处理失败",
        ),
      );
  });
}
