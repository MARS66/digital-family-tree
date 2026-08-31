import type { FastifyInstance } from "fastify";

import { authenticateRequest } from "../auth/request-authentication.js";
import type { AuthService } from "../auth/service.js";
import { personResponseSchema } from "../person/routes.js";
import type { FamilyService } from "./service.js";

const familyViewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "description",
    "originPlace",
    "ownerUserId",
    "status",
    "privacyPolicyVersion",
    "createdAt",
    "membership",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    originPlace: { type: ["string", "null"] },
    ownerUserId: { type: "string", format: "uuid" },
    status: { type: "string" },
    privacyPolicyVersion: { type: "integer", minimum: 1 },
    createdAt: { type: "string", format: "date-time" },
    membership: {
      type: "object",
      additionalProperties: false,
      required: ["role", "status", "joinedAt"],
      properties: {
        role: { type: "string" },
        status: { type: "string" },
        joinedAt: { type: ["string", "null"], format: "date-time" },
      },
    },
  },
} as const;

const partialDateInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "precision"],
  properties: {
    value: { type: "string" },
    precision: { type: "string", enum: ["YEAR", "MONTH", "DAY"] },
  },
} as const;

const personProperties = {
  primaryName: { type: "string", minLength: 1, maxLength: 100 },
  formerName: { type: ["string", "null"], maxLength: 100 },
  courtesyName: { type: ["string", "null"], maxLength: 100 },
  gender: { type: "string", enum: ["UNKNOWN", "MALE", "FEMALE", "OTHER"] },
  isLiving: { type: "string", enum: ["TRUE", "FALSE", "UNKNOWN"] },
  birthDate: { anyOf: [partialDateInputSchema, { type: "null" }] },
  deathDate: { anyOf: [partialDateInputSchema, { type: "null" }] },
  birthPlace: { type: ["string", "null"], maxLength: 200 },
  summary: { type: ["string", "null"], maxLength: 5000 },
  isPlaceholder: { type: "boolean" },
  placeholderLabel: { type: "string", maxLength: 200 },
} as const;

const bootstrapResponseSchema = {
  ...familyViewSchema,
  required: [...familyViewSchema.required, "firstPerson", "selfClaim"],
  properties: {
    ...familyViewSchema.properties,
    firstPerson: personResponseSchema,
    selfClaim: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "personId", "userId", "claimType", "status"],
          properties: {
            id: { type: "string", format: "uuid" },
            personId: { type: "string", format: "uuid" },
            userId: { type: "string", format: "uuid" },
            claimType: { type: "string", const: "SELF" },
            status: { type: "string", const: "APPROVED" },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;

function successSchema(data: object) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["data"],
    properties: { data },
  } as const;
}

export function registerFamilyRoutes(
  app: FastifyInstance,
  authService: AuthService,
  familyService: FamilyService,
): void {
  app.post<{
    Body: {
      name: string;
      description?: string;
      originPlace?: string;
      firstPerson: {
        primaryName?: string;
        formerName?: string | null;
        courtesyName?: string | null;
        gender?: "UNKNOWN" | "MALE" | "FEMALE" | "OTHER";
        isLiving?: "TRUE" | "FALSE" | "UNKNOWN";
        birthDate?: {
          value: string;
          precision: "YEAR" | "MONTH" | "DAY";
        } | null;
        deathDate?: {
          value: string;
          precision: "YEAR" | "MONTH" | "DAY";
        } | null;
        birthPlace?: string | null;
        summary?: string | null;
        isPlaceholder?: boolean;
        placeholderLabel?: string;
      };
      claimSelf?: boolean;
    };
  }>(
    "/api/v1/families",
    {
      schema: {
        operationId: "createFamily",
        summary: "原子创建家族、OWNER、首 Person 与可选 SELF claim",
        tags: ["family"],
        security: [{ bearerAuth: [], idempotencyKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "firstPerson"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            description: { type: "string", maxLength: 2000 },
            originPlace: { type: "string", maxLength: 200 },
            firstPerson: {
              type: "object",
              additionalProperties: false,
              properties: personProperties,
            },
            claimSelf: { type: "boolean", default: false },
          },
        },
        response: { 200: successSchema(bootstrapResponseSchema) },
      },
    },
    async (request) => {
      const user = await authenticateRequest(request, authService);
      return { data: await familyService.bootstrap(user.id, request.body) };
    },
  );

  app.get<{ Params: { familyId: string } }>(
    "/api/v1/families/:familyId",
    {
      schema: {
        operationId: "getFamily",
        summary: "读取当前成员可见的家族",
        tags: ["family"],
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["familyId"],
          properties: {
            familyId: { type: "string", format: "uuid" },
          },
        },
        response: { 200: successSchema(familyViewSchema) },
      },
    },
    async (request) => {
      const user = await authenticateRequest(request, authService);
      return {
        data: await familyService.get(user.id, request.params.familyId),
      };
    },
  );
}
