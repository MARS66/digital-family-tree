CREATE TABLE "person_claims" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "family_id" UUID NOT NULL,
  "person_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "claim_type" VARCHAR(16) NOT NULL DEFAULT 'SELF',
  "status" VARCHAR(16) NOT NULL,
  "evidence_source_id" UUID,
  "review_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "person_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "person_claims_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "person_claims_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "person_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "person_claims_type_check" CHECK ("claim_type" = 'SELF'),
  CONSTRAINT "person_claims_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'DISPUTED'))
);

CREATE UNIQUE INDEX "person_claims_approved_self_user_key"
  ON "person_claims"("family_id", "user_id")
  WHERE "claim_type" = 'SELF' AND "status" = 'APPROVED';
CREATE UNIQUE INDEX "person_claims_approved_self_person_key"
  ON "person_claims"("family_id", "person_id")
  WHERE "claim_type" = 'SELF' AND "status" = 'APPROVED';
CREATE INDEX "person_claims_family_status_idx" ON "person_claims"("family_id", "status");
CREATE INDEX "person_claims_user_status_idx" ON "person_claims"("user_id", "status");
CREATE INDEX "person_claims_person_status_idx" ON "person_claims"("person_id", "status");

CREATE FUNCTION enforce_person_claim_scope() RETURNS trigger AS $$
DECLARE
  person_family UUID;
  person_placeholder BOOLEAN;
  person_deleted TIMESTAMPTZ;
BEGIN
  SELECT family_id, is_placeholder, deleted_at
    INTO person_family, person_placeholder, person_deleted
    FROM persons WHERE id = NEW.person_id;
  IF person_family IS NULL OR person_family <> NEW.family_id OR person_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'claim person must be active and in the same family'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'APPROVED' AND person_placeholder THEN
    RAISE EXCEPTION 'placeholder person cannot be claimed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "person_claims_scope_trigger"
  BEFORE INSERT OR UPDATE OF "family_id", "person_id", "status"
  ON "person_claims"
  FOR EACH ROW EXECUTE FUNCTION enforce_person_claim_scope();
