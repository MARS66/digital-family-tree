import type { FastifyInstance } from "fastify";

import { authenticateRequest } from "../auth/request-authentication.js";
import type { AuthService } from "../auth/service.js";
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
    Body: { name: string; description?: string; originPlace?: string };
  }>(
    "/api/v1/families",
    {
      schema: {
        operationId: "createFamily",
        summary: "创建家族并成为 OWNER",
        tags: ["family"],
        security: [{ bearerAuth: [], idempotencyKey: [] }],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            description: { type: "string", maxLength: 2000 },
            originPlace: { type: "string", maxLength: 200 },
          },
        },
        response: { 200: successSchema(familyViewSchema) },
      },
    },
    async (request) => {
      const user = await authenticateRequest(request, authService);
      return { data: await familyService.create(user.id, request.body) };
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
