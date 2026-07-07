-- Linked KiCad project folder + auto-sync flag (desktop Phase 4).
-- Hand-written (see 20260706000000_add_app_setting for why `migrate dev`
-- can't be used against the drifted dev DB).

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "kicadProjectPath" TEXT;
ALTER TABLE "Project" ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
