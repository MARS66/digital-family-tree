export const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "traceId"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
        traceId: { type: "string", format: "uuid" },
      },
    },
  },
} as const;

export const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data"],
  properties: {
    data: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { type: "string", const: "ok" },
      },
    },
  },
} as const;
