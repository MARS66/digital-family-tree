import type { FastifyInstance } from "fastify";

import { authenticateRequest } from "../auth/request-authentication.js";
import type { AuthService } from "../auth/service.js";
import type { RelationshipService } from "./service.js";

const personSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "primaryName", "isPlaceholder"],
  properties: {
    id: { type: "string", format: "uuid" },
    primaryName: { type: "string" },
    isPlaceholder: { type: "boolean" },
  },
} as const;

const relatedPersonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["relationshipId", "parentRole", "person"],
  properties: {
    relationshipId: { type: "string", format: "uuid" },
    parentRole: { type: "string" },
    person: personSummarySchema,
  },
} as const;

export function registerRelationshipRoutes(
  app: FastifyInstance,
  authService: AuthService,
  relationshipService: RelationshipService,
): void {
  app.get<{ Params: { familyId: string; personId: string } }>(
    "/api/v1/families/:familyId/persons/:personId/relations",
    {
      schema: {
        operationId: "getPersonRelations",
        summary: "读取人物的父母、子女和推导兄弟姐妹",
        tags: ["relationship"],
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
            properties: {
              data: {
                type: "object",
                additionalProperties: false,
                required: [
                  "person",
                  "parents",
                  "children",
                  "siblings",
                  "partners",
                ],
                properties: {
                  person: personSummarySchema,
                  parents: {
                    type: "array",
                    items: relatedPersonSchema,
                  },
                  children: {
                    type: "array",
                    items: relatedPersonSchema,
                  },
                  siblings: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["kind", "sharedParentIds", "person"],
                      properties: {
                        kind: {
                          type: "string",
                          enum: ["FULL", "HALF", "UNKNOWN"],
                        },
                        sharedParentIds: {
                          type: "array",
                          items: { type: "string", format: "uuid" },
                        },
                        person: personSummarySchema,
                      },
                    },
                  },
                  partners: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: [
                        "unionId",
                        "unionType",
                        "startDate",
                        "endDate",
                        "person",
                      ],
                      properties: {
                        unionId: { type: "string", format: "uuid" },
                        unionType: {
                          type: "string",
                          enum: ["MARRIAGE", "PARTNERSHIP", "UNKNOWN"],
                        },
                        startDate: { type: ["string", "null"], format: "date" },
                        endDate: { type: ["string", "null"], format: "date" },
                        person: personSummarySchema,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const user = await authenticateRequest(request, authService);
      return {
        data: await relationshipService.getPersonRelations(
          user.id,
          request.params.familyId,
          request.params.personId,
        ),
      };
    },
  );
}
