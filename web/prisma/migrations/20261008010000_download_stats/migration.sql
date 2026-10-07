CREATE TABLE "DownloadDailyStat" (
    "day" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("day", "asset", "version", "locale", "source")
);
