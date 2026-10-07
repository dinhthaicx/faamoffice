-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "kind" TEXT NOT NULL DEFAULT 'rich',
    "level" TEXT NOT NULL DEFAULT 'info',
    "displayMode" TEXT NOT NULL DEFAULT 'once',
    "titleVi" TEXT NOT NULL,
    "titleEn" TEXT,
    "bodyVi" TEXT,
    "bodyEn" TEXT,
    "htmlVi" TEXT,
    "htmlEn" TEXT,
    "imageId" TEXT,
    "imageUrl" TEXT,
    "linkUrl" TEXT,
    "linkLabelVi" TEXT,
    "linkLabelEn" TEXT,
    "platforms" TEXT NOT NULL DEFAULT '',
    "minVersion" TEXT,
    "maxVersion" TEXT,
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Announcement_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "AnnouncementImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Announcement_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnouncementImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mime" TEXT NOT NULL,
    "bytes" BLOB NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Announcement_status_startsAt_idx" ON "Announcement"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Announcement_status_priority_startsAt_idx" ON "Announcement"("status", "priority", "startsAt");

-- CreateIndex
CREATE INDEX "Announcement_imageId_idx" ON "Announcement"("imageId");

-- CreateIndex
CREATE INDEX "Announcement_updatedAt_idx" ON "Announcement"("updatedAt");

-- CreateIndex
CREATE INDEX "AnnouncementImage_createdAt_idx" ON "AnnouncementImage"("createdAt");
