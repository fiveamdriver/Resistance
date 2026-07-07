-- AlterTable: physical placement from the .kicad_pcb layout
ALTER TABLE "Component" ADD COLUMN "posX" REAL;
ALTER TABLE "Component" ADD COLUMN "posY" REAL;
ALTER TABLE "Component" ADD COLUMN "rotation" REAL;
ALTER TABLE "Component" ADD COLUMN "layer" TEXT;

-- CreateTable: board-level layout facts (one per project)
CREATE TABLE "Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "widthMm" REAL,
    "heightMm" REAL,
    "layerCount" INTEGER,
    "copperLayers" TEXT NOT NULL DEFAULT '[]',
    "zones" TEXT NOT NULL DEFAULT '[]',
    "sourceFile" TEXT,
    "parsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Board_projectId_key" ON "Board"("projectId");
