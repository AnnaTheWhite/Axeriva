-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OwnerNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Inbox',
    "companyId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "projectId" INTEGER,
    "customerId" INTEGER,
    "employeeId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OwnerNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OwnerNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OwnerNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OwnerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OwnerNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OwnerNote" ("companyId", "content", "createdAt", "customerId", "id", "projectId", "status", "title", "updatedAt", "userId") SELECT "companyId", "content", "createdAt", "customerId", "id", "projectId", "status", "title", "updatedAt", "userId" FROM "OwnerNote";
DROP TABLE "OwnerNote";
ALTER TABLE "new_OwnerNote" RENAME TO "OwnerNote";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
