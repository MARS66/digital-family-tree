CREATE TABLE "partner_unions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "family_id" UUID NOT NULL,
  "person_a_id" UUID NOT NULL,
  "person_b_id" UUID NOT NULL,
  "union_type" VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
  "start_date" DATE,
  "end_date" DATE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "source_id" UUID,
  "created_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by" UUID,
  CONSTRAINT "partner_unions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_unions_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "partner_unions_person_a_id_fkey" FOREIGN KEY ("person_a_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_unions_person_b_id_fkey" FOREIGN KEY ("person_b_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_unions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_unions_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "partner_unions_canonical_endpoints_check" CHECK ("person_a_id" < "person_b_id"),
  CONSTRAINT "partner_unions_type_check" CHECK ("union_type" IN ('MARRIAGE', 'PARTNERSHIP', 'UNKNOWN')),
  CONSTRAINT "partner_unions_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT "partner_unions_dates_check" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT "partner_unions_version_check" CHECK ("version" >= 1),
  CONSTRAINT "partner_unions_delete_pair_check" CHECK (("deleted_at" IS NULL) = ("deleted_by" IS NULL))
);

CREATE UNIQUE INDEX "partner_unions_active_pair_key"
  ON "partner_unions"("family_id", "person_a_id", "person_b_id")
  WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE';
CREATE INDEX "partner_unions_family_a_status_idx"
  ON "partner_unions"("family_id", "person_a_id", "status");
CREATE INDEX "partner_unions_family_b_status_idx"
  ON "partner_unions"("family_id", "person_b_id", "status");

CREATE FUNCTION enforce_partner_union_family_scope() RETURNS trigger AS $$
DECLARE
  family_a UUID;
  family_b UUID;
  deleted_a TIMESTAMPTZ;
  deleted_b TIMESTAMPTZ;
BEGIN
  SELECT family_id, deleted_at INTO family_a, deleted_a FROM persons WHERE id = NEW.person_a_id;
  SELECT family_id, deleted_at INTO family_b, deleted_b FROM persons WHERE id = NEW.person_b_id;
  IF family_a IS NULL OR family_b IS NULL OR
     family_a <> NEW.family_id OR family_b <> NEW.family_id OR
     deleted_a IS NOT NULL OR deleted_b IS NOT NULL THEN
    RAISE EXCEPTION 'partner endpoints must be active persons in the same family'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "partner_unions_family_scope_trigger"
  BEFORE INSERT OR UPDATE OF "family_id", "person_a_id", "person_b_id", "status", "deleted_at"
  ON "partner_unions"
  FOR EACH ROW EXECUTE FUNCTION enforce_partner_union_family_scope();

CREATE OR REPLACE FUNCTION prevent_deleting_person_with_relationships() RETURNS trigger AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM relationships
      WHERE family_id = NEW.family_id
        AND status = 'ACTIVE'
        AND deleted_at IS NULL
        AND (from_person_id = NEW.id OR to_person_id = NEW.id)
    ) OR EXISTS (
      SELECT 1 FROM partner_unions
      WHERE family_id = NEW.family_id
        AND status = 'ACTIVE'
        AND deleted_at IS NULL
        AND (person_a_id = NEW.id OR person_b_id = NEW.id)
    )
  ) THEN
    RAISE EXCEPTION 'person has active relationships'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
