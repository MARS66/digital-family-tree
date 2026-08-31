CREATE TABLE "relationships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "family_id" UUID NOT NULL,
  "from_person_id" UUID NOT NULL,
  "to_person_id" UUID NOT NULL,
  "type" VARCHAR(32) NOT NULL DEFAULT 'PARENT_OF',
  "parent_role" VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "source_id" UUID,
  "valid_from" DATE,
  "valid_to" DATE,
  "created_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "relationships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "relationships_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "relationships_from_person_id_fkey" FOREIGN KEY ("from_person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "relationships_to_person_id_fkey" FOREIGN KEY ("to_person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "relationships_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "relationships_type_check" CHECK ("type" = 'PARENT_OF'),
  CONSTRAINT "relationships_parent_role_check" CHECK ("parent_role" IN ('FATHER', 'MOTHER', 'PARENT', 'UNKNOWN')),
  CONSTRAINT "relationships_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT "relationships_no_self_loop_check" CHECK ("from_person_id" <> "to_person_id"),
  CONSTRAINT "relationships_valid_dates_check" CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT "relationships_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "relationships_active_edge_key"
  ON "relationships"("family_id", "from_person_id", "to_person_id", "type")
  WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "relationships_active_parent_role_key"
  ON "relationships"("family_id", "to_person_id", "parent_role")
  WHERE "deleted_at" IS NULL AND "status" = 'ACTIVE' AND "parent_role" IN ('FATHER', 'MOTHER');
CREATE INDEX "relationships_family_from_status_idx"
  ON "relationships"("family_id", "from_person_id", "status");
CREATE INDEX "relationships_family_to_status_idx"
  ON "relationships"("family_id", "to_person_id", "status");

CREATE FUNCTION enforce_relationship_family_scope() RETURNS trigger AS $$
DECLARE
  parent_family UUID;
  child_family UUID;
  parent_deleted TIMESTAMPTZ;
  child_deleted TIMESTAMPTZ;
BEGIN
  SELECT family_id, deleted_at INTO parent_family, parent_deleted
    FROM persons WHERE id = NEW.from_person_id;
  SELECT family_id, deleted_at INTO child_family, child_deleted
    FROM persons WHERE id = NEW.to_person_id;
  IF parent_family IS NULL OR child_family IS NULL OR
     parent_family <> NEW.family_id OR child_family <> NEW.family_id OR
     parent_deleted IS NOT NULL OR child_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'relationship endpoints must be active persons in the same family'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "relationships_family_scope_trigger"
  BEFORE INSERT OR UPDATE OF "family_id", "from_person_id", "to_person_id", "status", "deleted_at"
  ON "relationships"
  FOR EACH ROW EXECUTE FUNCTION enforce_relationship_family_scope();

CREATE FUNCTION prevent_deleting_person_with_relationships() RETURNS trigger AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM relationships
    WHERE family_id = NEW.family_id
      AND status = 'ACTIVE'
      AND deleted_at IS NULL
      AND (from_person_id = NEW.id OR to_person_id = NEW.id)
  ) THEN
    RAISE EXCEPTION 'person has active relationships'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "persons_active_relationship_delete_trigger"
  BEFORE UPDATE OF "deleted_at" ON "persons"
  FOR EACH ROW EXECUTE FUNCTION prevent_deleting_person_with_relationships();
