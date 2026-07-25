-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectAttachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProjectAttachment" ("createdAt", "fileName", "fileSize", "fileType", "fileUrl", "id", "projectId", "userId") SELECT "createdAt", "fileName", "fileSize", "fileType", "fileUrl", "id", "projectId", "userId" FROM "ProjectAttachment";
DROP TABLE "ProjectAttachment";
ALTER TABLE "new_ProjectAttachment" RENAME TO "ProjectAttachment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
