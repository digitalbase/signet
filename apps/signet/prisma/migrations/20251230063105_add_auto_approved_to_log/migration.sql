-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "method" TEXT,
    "params" TEXT,
    "keyUserId" INTEGER,
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Log_keyUserId_fkey" FOREIGN KEY ("keyUserId") REFERENCES "KeyUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Log" ("id", "keyUserId", "method", "params", "timestamp", "type") SELECT "id", "keyUserId", "method", "params", "timestamp", "type" FROM "Log";
DROP TABLE "Log";
ALTER TABLE "new_Log" RENAME TO "Log";
CREATE INDEX "Log_timestamp_idx" ON "Log"("timestamp");
CREATE INDEX "Log_keyUserId_idx" ON "Log"("keyUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
