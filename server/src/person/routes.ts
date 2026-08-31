import type { FastifyInstance } from "fastify";

import { authenticateRequest } from "../auth/request-authentication.js";
import type { AuthService } from "../auth/service.js";
import type { PersonService } from "./service.js";

const partialDateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "precision"],
  properties: {
    value: { type: "string" },
    precision: { type: "string", enum: ["YEAR", "MONTH", "DAY"] },
  },
} as const;

const personSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "familyId",
    "primaryName",
    "formerName",
    "courtesyName",
    "gender",
    "isLiving",
    "birthDate",
    "deathDate",
    "birthPlace",
    "summary",
    "isPlaceholder",
    "placeholderLabel",
    "status",
    "version",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    familyId: { type: "string", format: "uuid" },
    primaryName: { type: "string" },
    formerName: { type: ["string", "null"] },
    courtesyName: { type: ["string", "null"] },
    gender: { type: "string", enum: ["UNKNOWN", "MALE", "FEMALE", "OTHER"] },
    isLiving: { type: "string", enum: ["TRUE", "FALSE", "UNKNOWN"] },
    birthDate: { anyOf: [partialDateSchema, { type: "null" }] },
    deathDate: { anyOf: [partialDateSchema, { type: "null" }] },
    birthPlace: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    isPlaceholder: { type: "boolean" },
    placeholderLabel: { type: ["string", "null"] },
    status: { type: "string" },
    version: { type: "integer", minimum: 1 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export function registerPersonRoutes(
  app: FastifyInstance,
  authService: AuthService,
  personService: PersonService,
): void {
  app.get<{ Params: { familyId: string; personId: string } }>(
    "/api/v1/families/:familyId/persons/:personId",
    {
      schema: {
        operationId: "getPerson",
        summary: "读取成员可见的人物基础资料",
        tags: ["person"],
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["familyId", "personId"],
          properties: {
            familyId: { type: "string", format: "uuid" },
            personId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: { data: personSchema },
          },
        },
      },
    },
    async (request) => {
      const user = await authenticateRequest(request, authService);
      return {
        data: await personService.get(
          user.id,
          request.params.familyId,
          request.params.personId,
        ),
      };
    },
  );
}
