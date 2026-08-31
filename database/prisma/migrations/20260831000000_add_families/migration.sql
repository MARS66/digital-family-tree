CREATE TABLE "families" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "description" TEXT,
  "origin_place" VARCHAR(200),
  "owner_user_id" UUID NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  "privacy_policy_version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "families_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "families_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT "families_privacy_policy_version_check" CHECK ("privacy_policy_version" >= 1),
  CONSTRAINT "families_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100),
  CONSTRAINT "families_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "families_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "family_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "family_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" VARCHAR(32) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "joined_at" TIMESTAMPTZ(6),
  "invitation_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "family_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_memberships_role_check" CHECK ("role" IN ('OWNER', 'FAMILY_ADMIN', 'MEMBER')),
  CONSTRAINT "family_memberships_status_check" CHECK ("status" IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT')),
  CONSTRAINT "family_memberships_joined_at_check" CHECK (("status" = 'INVITED' AND "joined_at" IS NULL) OR ("status" <> 'INVITED' AND "joined_at" IS NOT NULL)),
  CONSTRAINT "family_memberships_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "family_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "families_status_idx" ON "families"("status");
CREATE UNIQUE INDEX "family_memberships_family_id_user_id_key" ON "family_memberships"("family_id", "user_id");
CREATE INDEX "family_memberships_user_id_status_idx" ON "family_memberships"("user_id", "status");
CREATE INDEX "family_memberships_family_id_status_idx" ON "family_memberships"("family_id", "status");
