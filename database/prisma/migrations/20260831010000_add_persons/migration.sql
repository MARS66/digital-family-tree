CREATE TABLE "persons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "family_id" UUID NOT NULL,
  "primary_name" VARCHAR(100) NOT NULL,
  "former_name" VARCHAR(100),
  "courtesy_name" VARCHAR(100),
  "gender" VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
  "is_living" VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
  "birth_date" DATE,
  "birth_date_precision" VARCHAR(16),
  "death_date" DATE,
  "death_date_precision" VARCHAR(16),
  "birth_place" VARCHAR(200),
  "summary" TEXT,
  "is_placeholder" BOOLEAN NOT NULL DEFAULT false,
  "placeholder_label" VARCHAR(200),
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "merged_into_person_id" UUID,
  "created_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by" UUID,
  CONSTRAINT "persons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "persons_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "persons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "persons_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "persons_merged_into_person_id_fkey" FOREIGN KEY ("merged_into_person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "persons_gender_check" CHECK ("gender" IN ('UNKNOWN', 'MALE', 'FEMALE', 'OTHER')),
  CONSTRAINT "persons_is_living_check" CHECK ("is_living" IN ('TRUE', 'FALSE', 'UNKNOWN')),
  CONSTRAINT "persons_birth_precision_check" CHECK ("birth_date_precision" IS NULL OR "birth_date_precision" IN ('YEAR', 'MONTH', 'DAY')),
  CONSTRAINT "persons_death_precision_check" CHECK ("death_date_precision" IS NULL OR "death_date_precision" IN ('YEAR', 'MONTH', 'DAY')),
  CONSTRAINT "persons_birth_pair_check" CHECK (("birth_date" IS NULL) = ("birth_date_precision" IS NULL)),
  CONSTRAINT "persons_death_pair_check" CHECK (("death_date" IS NULL) = ("death_date_precision" IS NULL)),
  CONSTRAINT "persons_birth_canonical_check" CHECK (
    "birth_date" IS NULL OR
    "birth_date_precision" = 'DAY' OR
    ("birth_date_precision" = 'MONTH' AND EXTRACT(DAY FROM "birth_date") = 1) OR
    ("birth_date_precision" = 'YEAR' AND EXTRACT(MONTH FROM "birth_date") = 1 AND EXTRACT(DAY FROM "birth_date") = 1)
  ),
  CONSTRAINT "persons_death_canonical_check" CHECK (
    "death_date" IS NULL OR
    "death_date_precision" = 'DAY' OR
    ("death_date_precision" = 'MONTH' AND EXTRACT(DAY FROM "death_date") = 1) OR
    ("death_date_precision" = 'YEAR' AND EXTRACT(MONTH FROM "death_date") = 1 AND EXTRACT(DAY FROM "death_date") = 1)
  ),
  CONSTRAINT "persons_date_order_check" CHECK (
    "birth_date" IS NULL OR "death_date" IS NULL OR
    CASE "death_date_precision"
      WHEN 'YEAR' THEN ("death_date" + INTERVAL '1 year - 1 day')::date
      WHEN 'MONTH' THEN ("death_date" + INTERVAL '1 month - 1 day')::date
      ELSE "death_date"
    END >= "birth_date"
  ),
  CONSTRAINT "persons_placeholder_check" CHECK (
    ("is_placeholder" AND length(btrim("placeholder_label")) > 0 AND "primary_name" = "placeholder_label") OR
    (NOT "is_placeholder" AND "placeholder_label" IS NULL AND length(btrim("primary_name")) > 0)
  ),
  CONSTRAINT "persons_status_check" CHECK ("status" IN ('ACTIVE', 'MERGED', 'ARCHIVED')),
  CONSTRAINT "persons_merge_state_check" CHECK (
    ("status" = 'MERGED' AND "merged_into_person_id" IS NOT NULL) OR
    ("status" <> 'MERGED' AND "merged_into_person_id" IS NULL)
  ),
  CONSTRAINT "persons_no_self_merge_check" CHECK ("merged_into_person_id" IS NULL OR "merged_into_person_id" <> "id"),
  CONSTRAINT "persons_version_check" CHECK ("version" >= 1),
  CONSTRAINT "persons_delete_pair_check" CHECK (("deleted_at" IS NULL) = ("deleted_by" IS NULL))
);

CREATE INDEX "persons_family_id_status_idx" ON "persons"("family_id", "status");
CREATE INDEX "persons_family_id_primary_name_idx" ON "persons"("family_id", "primary_name");
CREATE INDEX "persons_merged_into_person_id_idx" ON "persons"("merged_into_person_id");
