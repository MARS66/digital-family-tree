import type {
  Family,
  FamilyMembership,
  PrismaClient,
} from "../generated/prisma/client.js";
import { ApiError } from "../http/errors.js";

export interface CreateFamilyInput {
  name: string;
  description?: string;
  originPlace?: string;
}

export interface FamilyView {
  id: string;
  name: string;
  description: string | null;
  originPlace: string | null;
  ownerUserId: string;
  status: string;
  privacyPolicyVersion: number;
  createdAt: string;
  membership: {
    role: string;
    status: string;
    joinedAt: string | null;
  };
}

function familyView(family: Family, membership: FamilyMembership): FamilyView {
  return {
    id: family.id,
    name: family.name,
    description: family.description,
    originPlace: family.originPlace,
    ownerUserId: family.ownerUserId,
    status: family.status,
    privacyPolicyVersion: family.privacyPolicyVersion,
    createdAt: family.createdAt.toISOString(),
    membership: {
      role: membership.role,
      status: membership.status,
      joinedAt: membership.joinedAt?.toISOString() ?? null,
    },
  };
}

export class FamilyService {
  constructor(private readonly database: PrismaClient) {}

  async create(userId: string, input: CreateFamilyInput): Promise<FamilyView> {
    const name = input.name.trim();
    const description = input.description?.trim() || null;
    const originPlace = input.originPlace?.trim() || null;
    const now = new Date();

    return this.database.$transaction(async (transaction) => {
      const family = await transaction.family.create({
        data: {
          name,
          description,
          originPlace,
          ownerUserId: userId,
          createdBy: userId,
        },
      });
      const membership = await transaction.familyMembership.create({
        data: {
          familyId: family.id,
          userId,
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: now,
        },
      });
      return familyView(family, membership);
    });
  }

  async get(userId: string, familyId: string): Promise<FamilyView> {
    const membership = await this.database.familyMembership.findUnique({
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
    return familyView(membership.family, membership);
  }
}
