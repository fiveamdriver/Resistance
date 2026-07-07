-- AlterTable: link each BOM row to its source file (audit #3 — overlapping
-- BOM sources). Nullable: legacy rows keep NULL until a re-parse adopts them.
-- ON DELETE CASCADE: deleting a BOM file removes the rows it produced.
ALTER TABLE "BomItem" ADD COLUMN "fileId" TEXT REFERENCES "ProjectFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "BomItem_fileId_idx" ON "BomItem"("fileId");
