import type {
  PartnerUnion,
  Prisma,
  PrismaClient,
} from "../generated/prisma/client.js";
import { ApiError } from "../http/errors.js";

export type PartnerUnionType = "MARRIAGE" | "PARTNERSHIP" | "UNKNOWN";

export interface CreatePartnerUnionInput {
  person1Id: string;
  person2Id: string;
  unionType?: PartnerUnionType;
  startDate?: string | null;
  endDate?: string | null;
}

export interface PartnerUnionView {
  id: string;
  familyId: string;
  personAId: string;
  personBId: string;
  unionType: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  version: number;
}

function canonicalEndpoints(
  firstId: string,
  secondId: string,
): [string, string] {
  return firstId < secondId ? [firstId, secondId] : [secondId, firstId];
}

function parseDate(
  value: string | null | undefined,
  label: string,
): Date | null {
  if (value == null) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) {
    throw new ApiError(422, "PARTNER_UNION_DATE_INVALID", label + "格式无效");
  }
  const date = new Date(value + "T00:00:00.000Z");
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new ApiError(
      422,
      "PARTNER_UNION_DATE_INVALID",
      label + "不是有效日期",
    );
  }
  return date;
}

function partnerUnionView(union: PartnerUnion): PartnerUnionView {
  return {
    id: union.id,
    familyId: union.familyId,
    personAId: union.personAId,
    personBId: union.personBId,
    unionType: union.unionType,
    startDate: union.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: union.endDate?.toISOString().slice(0, 10) ?? null,
    status: union.status,
    version: union.version,
  };
}

export class PartnerUnionService {
  constructor(private readonly database: PrismaClient) {}

  async create(
    actorUserId: string,
    familyId: string,
    input: CreatePartnerUnionInput,
  ): Promise<PartnerUnionView> {
    if (input.person1Id === input.person2Id) {
      throw new ApiError(
        422,
        "PARTNER_UNION_SELF_LOOP",
        "不能与同一人物建立伴侣关系",
      );
    }
    const [personAId, personBId] = canonicalEndpoints(
      input.person1Id,
      input.person2Id,
    );
    const startDate = parseDate(input.startDate, "开始日期");
    const endDate = parseDate(input.endDate, "结束日期");
    if (startDate && endDate && endDate < startDate) {
      throw new ApiError(
        422,
        "PARTNER_UNION_DATE_ORDER_INVALID",
        "结束日期不能早于开始日期",
      );
    }

    return this.database.$transaction(async (transaction) => {
      await this.lockFamily(transaction, familyId);
      await this.requireFamilyWrite(transaction, actorUserId, familyId);
      const people = await transaction.person.findMany({
        where: {
          familyId,
          id: { in: [personAId, personBId] },
          status: "ACTIVE",
          deletedAt: null,
        },
      });
      if (people.length !== 2) {
        throw new ApiError(
          422,
          "PARTNER_UNION_ENDPOINT_INVALID",
          "伴侣关系两端必须是同一家族中的有效人物",
        );
      }
      const duplicate = await transaction.partnerUnion.findFirst({
        where: {
          familyId,
          personAId,
          personBId,
          status: "ACTIVE",
          deletedAt: null,
        },
      });
      if (duplicate) {
        throw new ApiError(409, "PARTNER_UNION_DUPLICATE", "伴侣关系已存在");
      }
      return partnerUnionView(
        await transaction.partnerUnion.create({
          data: {
            familyId,
            personAId,
            personBId,
            unionType: input.unionType ?? "UNKNOWN",
            startDate,
            endDate,
            status: "ACTIVE",
            createdBy: actorUserId,
          },
        }),
      );
    });
  }

  async delete(
    actorUserId: string,
    familyId: string,
    unionId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await this.lockFamily(transaction, familyId);
      await this.requireFamilyWrite(transaction, actorUserId, familyId);
      const union = await transaction.partnerUnion.findFirst({
        where: { id: unionId, familyId, deletedAt: null, status: "ACTIVE" },
      });
      if (!union) {
        throw new ApiError(
          404,
          "PARTNER_UNION_NOT_FOUND",
          "伴侣关系不存在或无权访问",
        );
      }
      if (union.version !== expectedVersion) {
        throw new ApiError(
          409,
          "PARTNER_UNION_VERSION_CONFLICT",
          "伴侣关系已被修改",
          { currentVersion: union.version },
        );
      }
      const deleted = await transaction.partnerUnion.updateMany({
        where: {
          id: unionId,
          familyId,
          version: expectedVersion,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
          deletedBy: actorUserId,
          version: { increment: 1 },
        },
      });
      if (deleted.count !== 1) {
        throw new ApiError(
          409,
          "PARTNER_UNION_VERSION_CONFLICT",
          "伴侣关系已被修改",
        );
      }
    });
  }

  private async lockFamily(
    transaction: Prisma.TransactionClient,
    familyId: string,
  ): Promise<void> {
    await transaction.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      familyId,
    );
  }

  private async requireFamilyWrite(
    transaction: Prisma.TransactionClient,
    userId: string,
    familyId: string,
  ): Promise<void> {
    const membership = await transaction.familyMembership.findUnique({
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
    if (membership.role !== "OWNER" && membership.role !== "FAMILY_ADMIN") {
      throw new ApiError(
        403,
        "PARTNER_UNION_WRITE_FORBIDDEN",
        "无权写入伴侣关系",
      );
    }
  }
}
