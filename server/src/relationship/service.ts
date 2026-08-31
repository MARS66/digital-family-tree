import type {
  Person,
  Prisma,
  PrismaClient,
  Relationship,
} from "../generated/prisma/client.js";
import { ApiError } from "../http/errors.js";

export type ParentRole = "FATHER" | "MOTHER" | "PARENT" | "UNKNOWN";
export type SiblingKind = "FULL" | "HALF" | "UNKNOWN";

export interface CreateParentRelationshipInput {
  parentId: string;
  childId: string;
  parentRole?: ParentRole;
}

export interface PersonSummary {
  id: string;
  primaryName: string;
  isPlaceholder: boolean;
}

export interface ParentRelationshipView {
  id: string;
  familyId: string;
  parentId: string;
  childId: string;
  parentRole: string;
  status: string;
  version: number;
}

export interface PersonRelationsView {
  person: PersonSummary;
  parents: {
    relationshipId: string;
    parentRole: string;
    person: PersonSummary;
  }[];
  children: {
    relationshipId: string;
    parentRole: string;
    person: PersonSummary;
  }[];
  siblings: {
    kind: SiblingKind;
    sharedParentIds: string[];
    person: PersonSummary;
  }[];
  partners: {
    unionId: string;
    unionType: string;
    startDate: string | null;
    endDate: string | null;
    person: PersonSummary;
  }[];
}

function personSummary(person: Person): PersonSummary {
  return {
    id: person.id,
    primaryName: person.primaryName,
    isPlaceholder: person.isPlaceholder,
  };
}

function relationshipView(relationship: Relationship): ParentRelationshipView {
  return {
    id: relationship.id,
    familyId: relationship.familyId,
    parentId: relationship.fromPersonId,
    childId: relationship.toPersonId,
    parentRole: relationship.parentRole,
    status: relationship.status,
    version: relationship.version,
  };
}

export class RelationshipService {
  constructor(private readonly database: PrismaClient) {}

  async createParent(
    actorUserId: string,
    familyId: string,
    input: CreateParentRelationshipInput,
  ): Promise<ParentRelationshipView> {
    if (input.parentId === input.childId) {
      throw new ApiError(
        422,
        "RELATIONSHIP_SELF_LOOP",
        "人物不能成为自己的父母",
      );
    }

    return this.database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        familyId,
      );
      await this.requireFamilyAccess(transaction, actorUserId, familyId, true);
      const people = await transaction.person.findMany({
        where: {
          familyId,
          id: { in: [input.parentId, input.childId] },
          deletedAt: null,
          status: "ACTIVE",
        },
      });
      if (people.length !== 2) {
        throw new ApiError(
          422,
          "RELATIONSHIP_ENDPOINT_INVALID",
          "关系两端必须是同一家族中的有效人物",
        );
      }

      const duplicate = await transaction.relationship.findFirst({
        where: {
          familyId,
          fromPersonId: input.parentId,
          toPersonId: input.childId,
          type: "PARENT_OF",
          status: "ACTIVE",
          deletedAt: null,
        },
      });
      if (duplicate) {
        throw new ApiError(409, "RELATIONSHIP_DUPLICATE", "亲子关系已存在");
      }

      const parentRole = input.parentRole ?? "UNKNOWN";
      if (parentRole === "FATHER" || parentRole === "MOTHER") {
        const roleConflict = await transaction.relationship.findFirst({
          where: {
            familyId,
            toPersonId: input.childId,
            parentRole,
            status: "ACTIVE",
            deletedAt: null,
          },
        });
        if (roleConflict) {
          throw new ApiError(
            409,
            "PARENT_ROLE_CONFLICT",
            parentRole === "FATHER"
              ? "该人物已有有效的父亲关系"
              : "该人物已有有效的母亲关系",
          );
        }
      }

      const cycleRows = await transaction.$queryRawUnsafe<
        { wouldCycle: boolean }[]
      >(
        `
          WITH RECURSIVE descendants(id) AS (
            SELECT "to_person_id"
            FROM "relationships"
            WHERE "family_id" = $1::uuid
              AND "from_person_id" = $2::uuid
              AND "type" = 'PARENT_OF'
              AND "status" = 'ACTIVE'
              AND "deleted_at" IS NULL
            UNION
            SELECT relationship."to_person_id"
            FROM "relationships" relationship
            JOIN descendants ON relationship."from_person_id" = descendants.id
            WHERE relationship."family_id" = $1::uuid
              AND relationship."type" = 'PARENT_OF'
              AND relationship."status" = 'ACTIVE'
              AND relationship."deleted_at" IS NULL
          )
          SELECT EXISTS(
            SELECT 1 FROM descendants WHERE id = $3::uuid
          ) AS "wouldCycle"
        `,
        familyId,
        input.childId,
        input.parentId,
      );
      if (cycleRows[0]?.wouldCycle) {
        throw new ApiError(
          422,
          "RELATIONSHIP_CYCLE",
          "该亲子关系会形成祖先循环",
        );
      }

      const relationship = await transaction.relationship.create({
        data: {
          familyId,
          fromPersonId: input.parentId,
          toPersonId: input.childId,
          type: "PARENT_OF",
          parentRole,
          status: "ACTIVE",
          createdBy: actorUserId,
        },
      });
      return relationshipView(relationship);
    });
  }

  async getPersonRelations(
    actorUserId: string,
    familyId: string,
    personId: string,
  ): Promise<PersonRelationsView> {
    await this.requireFamilyAccess(this.database, actorUserId, familyId, false);
    const person = await this.database.person.findFirst({
      where: { id: personId, familyId, deletedAt: null, status: "ACTIVE" },
    });
    if (!person) {
      throw new ApiError(404, "PERSON_NOT_FOUND", "人物不存在或无权访问");
    }

    const [parentEdges, partnerUnions, childEdges] = await Promise.all([
      this.database.relationship.findMany({
        where: {
          familyId,
          toPersonId: personId,
          type: "PARENT_OF",
          status: "ACTIVE",
          deletedAt: null,
          parent: { deletedAt: null, status: "ACTIVE" },
        },
        include: { parent: true },
        orderBy: { createdAt: "asc" },
      }),
      this.database.partnerUnion.findMany({
        where: {
          familyId,
          status: "ACTIVE",
          deletedAt: null,
          OR: [{ personAId: personId }, { personBId: personId }],
        },
        include: { personA: true, personB: true },
        orderBy: { createdAt: "asc" },
      }),
      this.database.relationship.findMany({
        where: {
          familyId,
          fromPersonId: personId,
          type: "PARENT_OF",
          status: "ACTIVE",
          deletedAt: null,
          child: { deletedAt: null, status: "ACTIVE" },
        },
        include: { child: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const targetParentIds = new Set(
      parentEdges.map((relationship) => relationship.fromPersonId),
    );
    const siblingEdges =
      targetParentIds.size === 0
        ? []
        : await this.database.relationship.findMany({
            where: {
              familyId,
              fromPersonId: { in: [...targetParentIds] },
              toPersonId: { not: personId },
              type: "PARENT_OF",
              status: "ACTIVE",
              deletedAt: null,
              child: { deletedAt: null, status: "ACTIVE" },
            },
            include: { child: true },
          });
    const siblingIds = [
      ...new Set(siblingEdges.map((edge) => edge.toPersonId)),
    ];
    const allSiblingParentEdges =
      siblingIds.length === 0
        ? []
        : await this.database.relationship.findMany({
            where: {
              familyId,
              toPersonId: { in: siblingIds },
              type: "PARENT_OF",
              status: "ACTIVE",
              deletedAt: null,
            },
          });

    const siblingPeople = new Map(
      siblingEdges.map((edge) => [edge.child.id, edge.child]),
    );
    const siblingParentIds = new Map<string, Set<string>>();
    for (const edge of allSiblingParentEdges) {
      const ids = siblingParentIds.get(edge.toPersonId) ?? new Set<string>();
      ids.add(edge.fromPersonId);
      siblingParentIds.set(edge.toPersonId, ids);
    }
    const siblings = siblingIds.map((siblingId) => {
      const parentIds = siblingParentIds.get(siblingId) ?? new Set<string>();
      const sharedParentIds = [...parentIds].filter((id) =>
        targetParentIds.has(id),
      );
      const kind: SiblingKind =
        sharedParentIds.length >= 2
          ? "FULL"
          : targetParentIds.size >= 2 && parentIds.size >= 2
            ? "HALF"
            : "UNKNOWN";
      return {
        kind,
        sharedParentIds,
        person: personSummary(siblingPeople.get(siblingId)!),
      };
    });

    return {
      person: personSummary(person),
      parents: parentEdges.map((relationship) => ({
        relationshipId: relationship.id,
        parentRole: relationship.parentRole,
        person: personSummary(relationship.parent),
      })),
      children: childEdges.map((relationship) => ({
        relationshipId: relationship.id,
        parentRole: relationship.parentRole,
        person: personSummary(relationship.child),
      })),
      siblings,
      partners: partnerUnions.map((union) => {
        const partner =
          union.personAId === personId ? union.personB : union.personA;
        return {
          unionId: union.id,
          unionType: union.unionType,
          startDate: union.startDate?.toISOString().slice(0, 10) ?? null,
          endDate: union.endDate?.toISOString().slice(0, 10) ?? null,
          person: personSummary(partner),
        };
      }),
    };
  }

  private async requireFamilyAccess(
    database: Prisma.TransactionClient | PrismaClient,
    userId: string,
    familyId: string,
    write: boolean,
  ): Promise<void> {
    const membership = await database.familyMembership.findUnique({
      where: { familyId_userId: { familyId, userId } },
      include: { family: true },
    });
    if (
      !membership ||
      membership.status !== "ACTIVE" ||
      membership.family.status !== "ACTIVE" ||
      membership.family.deletedAt
    ) {
      throw new ApiError(404, "FAMILY_NOT_FOUND", "家族不存在或无权访问");
    }
    if (
      write &&
      membership.role !== "OWNER" &&
      membership.role !== "FAMILY_ADMIN"
    ) {
      throw new ApiError(403, "RELATIONSHIP_WRITE_FORBIDDEN", "无权写入关系");
    }
  }
}
