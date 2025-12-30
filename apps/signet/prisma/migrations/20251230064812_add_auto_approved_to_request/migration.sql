-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "requestId" TEXT NOT NULL,
    "remotePubkey" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "params" TEXT,
    "allowed" BOOLEAN,
    "autoApproved" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Request" ("allowed", "createdAt", "id", "keyName", "method", "params", "processedAt", "remotePubkey", "requestId") SELECT "allowed", "createdAt", "id", "keyName", "method", "params", "processedAt", "remotePubkey", "requestId" FROM "Request";
DROP TABLE "Request";
ALTER TABLE "new_Request" RENAME TO "Request";
CREATE INDEX "Request_allowed_createdAt_idx" ON "Request"("allowed", "createdAt");
CREATE INDEX "Request_remotePubkey_idx" ON "Request"("remotePubkey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
