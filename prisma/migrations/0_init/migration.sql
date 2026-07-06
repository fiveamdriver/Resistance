-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT,
    "syncMeta" TEXT,
    CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseError" TEXT,
    "provenance" TEXT NOT NULL DEFAULT 'upload',
    "sourceUrl" TEXT,
    "verifyStatus" TEXT NOT NULL DEFAULT 'verified',
    "contentHash" TEXT,
    "mpn" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "refDes" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "value" TEXT,
    "footprint" TEXT,
    "mpn" TEXT,
    "datasheetUrl" TEXT,
    CONSTRAINT "Component_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Net" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Net_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "componentId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT,
    CONSTRAINT "Pin_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "netId" TEXT NOT NULL,
    "pinId" TEXT NOT NULL,
    CONSTRAINT "Connection_netId_fkey" FOREIGN KEY ("netId") REFERENCES "Net" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Connection_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "Pin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BomItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "refDesRaw" TEXT,
    "description" TEXT,
    "manufacturer" TEXT,
    "mpn" TEXT,
    "value" TEXT,
    "footprint" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BomItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fileId" TEXT,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "page" INTEGER,
    "content" TEXT NOT NULL,
    "embedding" TEXT,
    "metadata" TEXT,
    CONSTRAINT "DocumentChunk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentChunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProjectFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "model" TEXT NOT NULL,
    "summary" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DatasheetLibrary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mpn" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MpnCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mpn" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "datasheetUrl" TEXT,
    "specs" TEXT,
    "error" TEXT,
    "fetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewRunId" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "refDes" TEXT NOT NULL,
    "hwReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Finding_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_BomItemToComponent" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_BomItemToComponent_A_fkey" FOREIGN KEY ("A") REFERENCES "BomItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_BomItemToComponent_B_fkey" FOREIGN KEY ("B") REFERENCES "Component" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");

-- CreateIndex
CREATE INDEX "Component_projectId_idx" ON "Component"("projectId");

-- CreateIndex
CREATE INDEX "Component_mpn_idx" ON "Component"("mpn");

-- CreateIndex
CREATE UNIQUE INDEX "Component_projectId_refDes_key" ON "Component"("projectId", "refDes");

-- CreateIndex
CREATE INDEX "Net_projectId_idx" ON "Net"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Net_projectId_name_key" ON "Net"("projectId", "name");

-- CreateIndex
CREATE INDEX "Pin_componentId_idx" ON "Pin"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "Pin_componentId_number_key" ON "Pin"("componentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_pinId_key" ON "Connection"("pinId");

-- CreateIndex
CREATE INDEX "Connection_netId_idx" ON "Connection"("netId");

-- CreateIndex
CREATE INDEX "BomItem_projectId_idx" ON "BomItem"("projectId");

-- CreateIndex
CREATE INDEX "DocumentChunk_projectId_idx" ON "DocumentChunk"("projectId");

-- CreateIndex
CREATE INDEX "DocumentChunk_fileId_idx" ON "DocumentChunk"("fileId");

-- CreateIndex
CREATE INDEX "ReviewRun_projectId_idx" ON "ReviewRun"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DatasheetLibrary_contentHash_key" ON "DatasheetLibrary"("contentHash");

-- CreateIndex
CREATE INDEX "DatasheetLibrary_mpn_idx" ON "DatasheetLibrary"("mpn");

-- CreateIndex
CREATE UNIQUE INDEX "MpnCache_mpn_key" ON "MpnCache"("mpn");

-- CreateIndex
CREATE INDEX "MpnCache_mpn_idx" ON "MpnCache"("mpn");

-- CreateIndex
CREATE INDEX "Finding_reviewRunId_idx" ON "Finding"("reviewRunId");

-- CreateIndex
CREATE UNIQUE INDEX "_BomItemToComponent_AB_unique" ON "_BomItemToComponent"("A", "B");

-- CreateIndex
CREATE INDEX "_BomItemToComponent_B_index" ON "_BomItemToComponent"("B");

