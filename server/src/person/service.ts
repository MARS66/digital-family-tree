import type {
  Person,
  Prisma,
  PrismaClient,
} from "../generated/prisma/client.js";
import { ApiError } from "../http/errors.js";

export type DatePrecision = "YEAR" | "MONTH" | "DAY";
export type Gender = "UNKNOWN" | "MALE" | "FEMALE" | "OTHER";
export type LivingStatus = "TRUE" | "FALSE" | "UNKNOWN";

export interface PartialDateInput {
  value: string;
  precision: DatePrecision;
}

export interface CreatePersonInput {
  primaryName?: string;
  formerName?: string | null;
  courtesyName?: string | null;
  gender?: Gender;
  isLiving?: LivingStatus;
  birthDate?: PartialDateInput | null;
  deathDate?: PartialDateInput | null;
  birthPlace?: string | null;
  summary?: string | null;
  isPlaceholder?: boolean;
  placeholderLabel?: string;
}

export interface UpdatePersonInput {
  expectedVersion: number;
  primaryName?: string;
  formerName?: string | null;
  courtesyName?: string | null;
  gender?: Gender;
  isLiving?: LivingStatus;
  birthDate?: PartialDateInput | null;
  deathDate?: PartialDateInput | null;
  birthPlace?: string | null;
  summary?: string | null;
  isPlaceholder?: boolean;
  placeholderLabel?: string | null;
}

export interface PersonView {
  id: string;
  familyId: string;
  primaryName: string;
  formerName: string | null;
  courtesyName: string | null;
  gender: string;
  isLiving: string;
  birthDate: PartialDateInput | null;
  deathDate: PartialDateInput | null;
  birthPlace: string | null;
  summary: string | null;
  isPlaceholder: boolean;
  placeholderLabel: string | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface NormalizedDate {
  date: Date;
  precision: DatePrecision;
}

function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function normalizePartialDate(
  input: PartialDateInput | null | undefined,
  fieldName: string,
): NormalizedDate | null {
  if (input == null) return null;
  const patterns: Record<DatePrecision, RegExp> = {
    YEAR: /^\d{4}$/,
    MONTH: /^\d{4}-(0[1-9]|1[0-2])$/,
    DAY: /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/,
  };
  if (!patterns[input.precision].test(input.value)) {
    throw new ApiError(422, "PERSON_DATE_INVALID", `${fieldName} 与精度不匹配`);
  }
  const canonical =
    input.precision === "YEAR"
      ? `${input.value}-01-01`
      : input.precision === "MONTH"
        ? `${input.value}-01`
        : input.value;
  const date = new Date(`${canonical}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== canonical
  ) {
    throw new ApiError(422, "PERSON_DATE_INVALID", `${fieldName} 不是有效日期`);
  }
  return { date, precision: input.precision };
}

function partialDateView(
  date: Date | null,
  precision: string | null,
): PartialDateInput | null {
  if (!date || !precision) return null;
  const canonical = date.toISOString().slice(0, 10);
  return {
    value:
      precision === "YEAR"
        ? canonical.slice(0, 4)
        : precision === "MONTH"
          ? canonical.slice(0, 7)
          : canonical,
    precision: precision as DatePrecision,
  };
}

function personView(person: Person): PersonView {
  return {
    id: person.id,
    familyId: person.familyId,
    primaryName: person.primaryName,
    formerName: person.formerName,
    courtesyName: person.courtesyName,
    gender: person.gender,
    isLiving: person.isLiving,
    birthDate: partialDateView(person.birthDate, person.birthDatePrecision),
    deathDate: partialDateView(person.deathDate, person.deathDatePrecision),
    birthPlace: person.birthPlace,
    summary: person.summary,
    isPlaceholder: person.isPlaceholder,
    placeholderLabel: person.placeholderLabel,
    status: person.status,
    version: person.version,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
  };
}

function validateIdentity(
  isPlaceholder: boolean,
  primaryNameInput: string | undefined,
  placeholderLabelInput: string | null | undefined,
): { primaryName: string; placeholderLabel: string | null } {
  const primaryName = primaryNameInput?.trim() ?? "";
  const placeholderLabel = placeholderLabelInput?.trim() ?? "";
  if (isPlaceholder) {
    if (!placeholderLabel) {
      throw new ApiError(
        422,
        "PLACEHOLDER_LABEL_REQUIRED",
        "占位人物必须提供上下文标签",
      );
    }
    return { primaryName: placeholderLabel, placeholderLabel };
  }
  if (!primaryName) {
    throw new ApiError(422, "PRIMARY_NAME_REQUIRED", "人物姓名不能为空");
  }
  return { primaryName, placeholderLabel: null };
}

function validateDateOrder(
  birthDate: NormalizedDate | null,
  deathDate: NormalizedDate | null,
): void {
  if (!birthDate || !deathDate) return;
  const deathLatest = new Date(deathDate.date);
  if (deathDate.precision === "YEAR") {
    deathLatest.setUTCFullYear(deathLatest.getUTCFullYear() + 1);
    deathLatest.setUTCDate(deathLatest.getUTCDate() - 1);
  } else if (deathDate.precision === "MONTH") {
    deathLatest.setUTCMonth(deathLatest.getUTCMonth() + 1);
    deathLatest.setUTCDate(deathLatest.getUTCDate() - 1);
  }
  if (deathLatest < birthDate.date) {
    throw new ApiError(
      422,
      "PERSON_DATE_ORDER_INVALID",
      "死亡日期不能早于出生日期",
    );
  }
}

export class PersonService {
  constructor(private readonly database: PrismaClient) {}

  async create(
    actorUserId: string,
    familyId: string,
    input: CreatePersonInput,
  ): Promise<PersonView> {
    await this.requireFamilyAccess(actorUserId, familyId, true);
    const identity = validateIdentity(
      input.isPlaceholder ?? false,
      input.primaryName,
      input.placeholderLabel,
    );
    const birthDate = normalizePartialDate(input.birthDate, "出生日期");
    const deathDate = normalizePartialDate(input.deathDate, "死亡日期");
    validateDateOrder(birthDate, deathDate);

    const person = await this.database.person.create({
      data: {
        familyId,
        ...identity,
        formerName: optionalText(input.formerName),
        courtesyName: optionalText(input.courtesyName),
        gender: input.gender ?? "UNKNOWN",
        isLiving: input.isLiving ?? "UNKNOWN",
        birthDate: birthDate?.date ?? null,
        birthDatePrecision: birthDate?.precision ?? null,
        deathDate: deathDate?.date ?? null,
        deathDatePrecision: deathDate?.precision ?? null,
        birthPlace: optionalText(input.birthPlace),
        summary: optionalText(input.summary),
        isPlaceholder: input.isPlaceholder ?? false,
        createdBy: actorUserId,
      },
    });
    return personView(person);
  }

  async get(
    actorUserId: string,
    familyId: string,
    personId: string,
  ): Promise<PersonView> {
    await this.requireFamilyAccess(actorUserId, familyId, false);
    return personView(await this.findVisiblePerson(familyId, personId));
  }

  async update(
    actorUserId: string,
    familyId: string,
    personId: string,
    input: UpdatePersonInput,
  ): Promise<PersonView> {
    await this.requireFamilyAccess(actorUserId, familyId, true);
    const current = await this.findVisiblePerson(familyId, personId);
    if (current.version !== input.expectedVersion) {
      this.versionConflict(current);
    }

    const isPlaceholder = input.isPlaceholder ?? current.isPlaceholder;
    const identity = validateIdentity(
      isPlaceholder,
      input.primaryName ?? current.primaryName,
      input.placeholderLabel === undefined
        ? current.placeholderLabel
        : input.placeholderLabel,
    );
    const birthDate =
      input.birthDate === undefined
        ? current.birthDate
          ? {
              date: current.birthDate,
              precision: current.birthDatePrecision as DatePrecision,
            }
          : null
        : normalizePartialDate(input.birthDate, "出生日期");
    const deathDate =
      input.deathDate === undefined
        ? current.deathDate
          ? {
              date: current.deathDate,
              precision: current.deathDatePrecision as DatePrecision,
            }
          : null
        : normalizePartialDate(input.deathDate, "死亡日期");
    validateDateOrder(birthDate, deathDate);

    const data: Prisma.PersonUpdateManyMutationInput = {
      ...identity,
      ...(input.formerName === undefined
        ? {}
        : { formerName: optionalText(input.formerName) }),
      ...(input.courtesyName === undefined
        ? {}
        : { courtesyName: optionalText(input.courtesyName) }),
      ...(input.gender === undefined ? {} : { gender: input.gender }),
      ...(input.isLiving === undefined ? {} : { isLiving: input.isLiving }),
      ...(input.birthDate === undefined
        ? {}
        : {
            birthDate: birthDate?.date ?? null,
            birthDatePrecision: birthDate?.precision ?? null,
          }),
      ...(input.deathDate === undefined
        ? {}
        : {
            deathDate: deathDate?.date ?? null,
            deathDatePrecision: deathDate?.precision ?? null,
          }),
      ...(input.birthPlace === undefined
        ? {}
        : { birthPlace: optionalText(input.birthPlace) }),
      ...(input.summary === undefined
        ? {}
        : { summary: optionalText(input.summary) }),
      isPlaceholder,
      version: { increment: 1 },
    };
    const updated = await this.database.person.updateMany({
      where: {
        id: personId,
        familyId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data,
    });
    if (updated.count !== 1) {
      const latest = await this.findVisiblePerson(familyId, personId);
      this.versionConflict(latest);
    }
    return personView(await this.findVisiblePerson(familyId, personId));
  }

  async delete(
    actorUserId: string,
    familyId: string,
    personId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.requireFamilyAccess(actorUserId, familyId, true);
    const current = await this.findVisiblePerson(familyId, personId);
    if (current.version !== expectedVersion) this.versionConflict(current);

    const deleted = await this.database.person.updateMany({
      where: {
        id: personId,
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
      throw new ApiError(409, "PERSON_VERSION_CONFLICT", "人物资料已被修改");
    }
  }

  private async requireFamilyAccess(
    userId: string,
    familyId: string,
    write: boolean,
  ): Promise<void> {
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
    if (
      write &&
      membership.role !== "OWNER" &&
      membership.role !== "FAMILY_ADMIN"
    ) {
      throw new ApiError(403, "PERSON_WRITE_FORBIDDEN", "无权直接写入人物资料");
    }
  }

  private async findVisiblePerson(
    familyId: string,
    personId: string,
  ): Promise<Person> {
    const person = await this.database.person.findFirst({
      where: { id: personId, familyId, deletedAt: null },
    });
    if (!person) {
      throw new ApiError(404, "PERSON_NOT_FOUND", "人物不存在或无权访问");
    }
    return person;
  }

  private versionConflict(person: Person): never {
    throw new ApiError(409, "PERSON_VERSION_CONFLICT", "人物资料已被修改", {
      currentVersion: person.version,
    });
  }
}
