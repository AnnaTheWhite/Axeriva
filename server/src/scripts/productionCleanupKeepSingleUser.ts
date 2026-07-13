// ============================================================================
// ONE-TIME PRODUCTION CLEANUP — KEEP A SINGLE USER, DELETE EVERYTHING ELSE
// ============================================================================
//
// ⚠️  THIS SCRIPT PERMANENTLY DELETES DATA. THERE IS NO UNDO.
//
// What it does:
//   - Keeps exactly one User (by email, see KEEP_EMAIL below).
//   - Deletes every other User.
//   - Deletes every Company except the kept user's own company (if any).
//   - Deletes every row in every table that depends on those companies/users
//     (employees, customers, projects, shifts, project assignments, notes,
//     attachments, activity, owner notes + conversions, tasks, reminders,
//     communication logs, project internal notes, invitations, audit logs),
//     in the correct foreign-key-safe order.
//   - Runs the whole thing inside a single Prisma interactive transaction:
//     if any step throws, EVERYTHING rolls back automatically.
//
// Safety features (read before running):
//   1. DRY RUN BY DEFAULT. Without DRY_RUN=false, this script only COUNTS
//      what it would delete and prints a report — it deletes nothing.
//   2. A second explicit confirmation token (CONFIRM=DELETE-ALL-EXCEPT-KEEP-EMAIL)
//      is required in addition to DRY_RUN=false, so a stray "DRY_RUN=false"
//      left in an env file can't trigger a real deletion by accident.
//   3. If the "keep" user does not exist, the script refuses to run at all
//      (it will NOT fall back to "delete everyone").
//   4. KEEP_EMAIL is configurable via env var so this script isn't
//      hardcoded to one address if reused later.
//
// This script does NOT modify the Prisma schema. It only reads/writes rows
// through the existing generated Prisma Client, against whatever
// DATABASE_URL the process is run with — YOU control that by how you invoke
// it (see "How to run" below). Nothing in this file connects to, or assumes,
// any particular database; it uses the same `prisma` client every other
// script/route in this project already uses.
//
// How to run (you run this yourself — this script is never executed by the
// assistant):
//
//   1. Dry run first (always) — prints the report, deletes nothing:
//        cd server
//        DATABASE_URL="<your production connection string>" \
//          npx ts-node --transpile-only src/scripts/productionCleanupKeepSingleUser.ts
//
//   2. Review the printed report carefully. It lists exactly how many rows
//      in each table would be deleted, and which companies/emails are
//      affected.
//
//   3. Only if the dry run looks correct, run for real:
//        cd server
//        DATABASE_URL="<your production connection string>" \
//          DRY_RUN=false \
//          CONFIRM=DELETE-ALL-EXCEPT-KEEP-EMAIL \
//          npx ts-node --transpile-only src/scripts/productionCleanupKeepSingleUser.ts
//
//   Optional: override which account is kept (defaults to
//   feher1304@outlook.com) by setting KEEP_EMAIL:
//        KEEP_EMAIL="someone@example.com" DRY_RUN=false CONFIRM=... \
//          npx ts-node --transpile-only src/scripts/productionCleanupKeepSingleUser.ts
//
// Exit codes: 0 on success (including a completed dry run), non-zero (1) on
// any failure — missing keep-user, missing confirmation, or any error during
// the transaction (which is rolled back before the process exits).
// ============================================================================

import prisma from "../database/prisma";

const KEEP_EMAIL = process.env.KEEP_EMAIL?.trim() || "feher1304@outlook.com";
const DRY_RUN = process.env.DRY_RUN !== "false";
const CONFIRM_TOKEN = "DELETE-ALL-EXCEPT-KEEP-EMAIL";

type DeletionCounts = {
  ownerNoteConversion: number;
  projectInternalNote: number;
  communicationLog: number;
  reminder: number;
  task: number;
  ownerNote: number;
  projectActivity: number;
  projectAttachment: number;
  projectNote: number;
  shift: number;
  projectAssignment: number;
  invitation: number;
  auditLogByCompany: number;
  auditLogOrphanByUser: number;
  project: number;
  customer: number;
  user: number;
  employee: number;
  company: number;
};

function emptyCounts(): DeletionCounts {
  return {
    ownerNoteConversion: 0,
    projectInternalNote: 0,
    communicationLog: 0,
    reminder: 0,
    task: 0,
    ownerNote: 0,
    projectActivity: 0,
    projectAttachment: 0,
    projectNote: 0,
    shift: 0,
    projectAssignment: 0,
    invitation: 0,
    auditLogByCompany: 0,
    auditLogOrphanByUser: 0,
    project: 0,
    customer: 0,
    user: 0,
    employee: 0,
    company: 0,
  };
}

async function main() {
  console.log("============================================================");
  console.log("Production cleanup — keep single user, delete everything else");
  console.log("============================================================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no data will be deleted)" : "LIVE — DATA WILL BE DELETED"}`);
  console.log(`Keeping user: ${KEEP_EMAIL}`);
  console.log("");

  // --- Safety gate 1: real runs require the explicit confirmation token ---
  if (!DRY_RUN && process.env.CONFIRM !== CONFIRM_TOKEN) {
    console.error(
      `Refusing to run destructively. Set CONFIRM=${CONFIRM_TOKEN} in addition ` +
        "to DRY_RUN=false to proceed. Aborting — nothing was touched."
    );
    process.exit(1);
  }

  // --- Safety gate 2: the account to keep must actually exist ------------
  const keepUser = await prisma.user.findUnique({
    where: { email: KEEP_EMAIL },
    select: { id: true, email: true, companyId: true, role: true },
  });

  if (!keepUser) {
    console.error(
      `Refusing to run: no user found with email "${KEEP_EMAIL}". ` +
        "This script will NOT fall back to deleting everyone. Aborting — nothing was touched."
    );
    process.exit(1);
  }

  console.log(
    `Found user to keep: id=${keepUser.id}, role=${keepUser.role}, companyId=${keepUser.companyId ?? "null"}`
  );

  const keepCompanyId = keepUser.companyId;
  // Captured as a plain non-nullable value (not `keepUser.id`) so the nested
  // runDeletion() closure below doesn't need to re-narrow `keepUser` past
  // the null check above.
  const keepUserId = keepUser.id;

  // --- Determine scope: which companies and users are being removed ------
  const companiesToDelete = await prisma.company.findMany({
    where: keepCompanyId === null ? {} : { id: { not: keepCompanyId } },
    select: { id: true, name: true },
  });
  const doomedCompanyIds = companiesToDelete.map((c) => c.id);

  const usersToDelete = await prisma.user.findMany({
    where: { id: { not: keepUserId } },
    select: { id: true, email: true },
  });
  const doomedUserIds = usersToDelete.map((u) => u.id);

  console.log(`Companies to delete: ${doomedCompanyIds.length}`);
  console.log(`Users to delete: ${doomedUserIds.length}`);
  console.log("");

  if (doomedUserIds.length === 0 && doomedCompanyIds.length === 0) {
    console.log("Nothing to delete — database is already in the desired state.");
    process.exit(0);
  }

  const counts = emptyCounts();

  // --- Deletion, in FK-dependency-safe order (children before parents) ---
  // Wrapped in a single interactive transaction: if ANY step throws, Prisma
  // rolls back everything automatically and the error propagates to the
  // catch() below, which exits non-zero without having changed anything.
  async function runDeletion(tx: typeof prisma) {
    counts.ownerNoteConversion = (
      await tx.ownerNoteConversion.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    counts.projectInternalNote = (
      await tx.projectInternalNote.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    counts.communicationLog = (
      await tx.communicationLog.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    counts.reminder = (
      await tx.reminder.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    counts.task = (
      await tx.task.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    counts.ownerNote = (
      await tx.ownerNote.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    counts.projectActivity = (
      await tx.projectActivity.deleteMany({ where: { project: { companyId: { in: doomedCompanyIds } } } })
    ).count;

    counts.projectAttachment = (
      await tx.projectAttachment.deleteMany({ where: { project: { companyId: { in: doomedCompanyIds } } } })
    ).count;

    counts.projectNote = (
      await tx.projectNote.deleteMany({ where: { project: { companyId: { in: doomedCompanyIds } } } })
    ).count;

    counts.shift = (
      await tx.shift.deleteMany({ where: { employee: { companyId: { in: doomedCompanyIds } } } })
    ).count;

    counts.projectAssignment = (
      await tx.projectAssignment.deleteMany({
        where: {
          OR: [
            { project: { companyId: { in: doomedCompanyIds } } },
            { employee: { companyId: { in: doomedCompanyIds } } },
          ],
        },
      })
    ).count;

    counts.invitation = (
      await tx.invitation.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    // Company-scoped audit logs.
    counts.auditLogByCompany = (
      await tx.auditLog.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    // Audit logs written by a deleted user with no company context
    // (companyId is nullable and userId is a plain int column, not a real
    // foreign key — this pass prevents those from becoming orphaned
    // references to a user id that no longer exists).
    counts.auditLogOrphanByUser = (
      await tx.auditLog.deleteMany({ where: { companyId: null, userId: { in: doomedUserIds } } })
    ).count;

    counts.project = (
      await tx.project.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    counts.customer = (
      await tx.customer.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    // Every user except the one being kept — covers users in doomed
    // companies AND any stray users not attached to any company.
    counts.user = (
      await tx.user.deleteMany({ where: { id: { not: keepUserId } } })
    ).count;

    // Employee rows belong to companies, not users directly; safe to delete
    // now that every User row that could reference one (User.employeeId)
    // has already been removed.
    counts.employee = (
      await tx.employee.deleteMany({ where: { companyId: { in: doomedCompanyIds } } })
    ).count;

    counts.company = (
      await tx.company.deleteMany({ where: { id: { in: doomedCompanyIds } } })
    ).count;
  }

  if (DRY_RUN) {
    // Dry run: execute the same logic inside a transaction that is always
    // rolled back, so we get real counts without persisting anything.
    try {
      await prisma.$transaction(async (tx) => {
        await runDeletion(tx as unknown as typeof prisma);
        throw new DryRunRollback();
      });
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
    }
  } else {
    await prisma.$transaction(async (tx) => {
      await runDeletion(tx as unknown as typeof prisma);
    });
  }

  // --- Report ---------------------------------------------------------
  console.log("------------------------------------------------------------");
  console.log(DRY_RUN ? "DRY RUN REPORT (nothing was actually deleted):" : "DELETION REPORT:");
  console.log("------------------------------------------------------------");
  console.log(`OwnerNoteConversion   : ${counts.ownerNoteConversion}`);
  console.log(`ProjectInternalNote   : ${counts.projectInternalNote}`);
  console.log(`CommunicationLog      : ${counts.communicationLog}`);
  console.log(`Reminder              : ${counts.reminder}`);
  console.log(`Task                  : ${counts.task}`);
  console.log(`OwnerNote             : ${counts.ownerNote}`);
  console.log(`ProjectActivity       : ${counts.projectActivity}`);
  console.log(`ProjectAttachment     : ${counts.projectAttachment}`);
  console.log(`ProjectNote           : ${counts.projectNote}`);
  console.log(`Shift                 : ${counts.shift}`);
  console.log(`ProjectAssignment     : ${counts.projectAssignment}`);
  console.log(`Invitation            : ${counts.invitation}`);
  console.log(`AuditLog (by company) : ${counts.auditLogByCompany}`);
  console.log(`AuditLog (orphan user): ${counts.auditLogOrphanByUser}`);
  console.log(`Project               : ${counts.project}`);
  console.log(`Customer              : ${counts.customer}`);
  console.log(`User                  : ${counts.user}`);
  console.log(`Employee              : ${counts.employee}`);
  console.log(`Company               : ${counts.company}`);
  console.log("------------------------------------------------------------");
  console.log(`Freed email addresses (${usersToDelete.length}):`);
  for (const u of usersToDelete) {
    console.log(`  - ${u.email}`);
  }
  console.log("------------------------------------------------------------");

  if (DRY_RUN) {
    console.log("This was a DRY RUN. No data was deleted.");
    console.log(
      "To execute for real, re-run with DRY_RUN=false and CONFIRM=" + CONFIRM_TOKEN + "."
    );
    process.exit(0);
  }

  // --- Post-deletion verification -----------------------------------
  const remainingUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const remainingDoomedCompanies = await prisma.company.count({
    where: { id: { in: doomedCompanyIds } },
  });
  const orphanEmployees = await prisma.employee.count({ where: { companyId: { in: doomedCompanyIds } } });
  const orphanCustomers = await prisma.customer.count({ where: { companyId: { in: doomedCompanyIds } } });
  const orphanProjects = await prisma.project.count({ where: { companyId: { in: doomedCompanyIds } } });
  const orphanInvitations = await prisma.invitation.count({ where: { companyId: { in: doomedCompanyIds } } });
  const reusableEmail = await prisma.user.findUnique({ where: { email: usersToDelete[0]?.email ?? "" } });

  console.log("VERIFICATION:");
  console.log(`  Remaining users: ${remainingUsers.length} -> ${JSON.stringify(remainingUsers)}`);
  console.log(`  Doomed companies still present: ${remainingDoomedCompanies} (expected 0)`);
  console.log(`  Orphaned employees in doomed companies: ${orphanEmployees} (expected 0)`);
  console.log(`  Orphaned customers in doomed companies: ${orphanCustomers} (expected 0)`);
  console.log(`  Orphaned projects in doomed companies: ${orphanProjects} (expected 0)`);
  console.log(`  Orphaned invitations in doomed companies: ${orphanInvitations} (expected 0)`);
  if (usersToDelete[0]) {
    console.log(
      `  Spot-check "${usersToDelete[0].email}" re-registrable: ${reusableEmail === null ? "YES (no row found)" : "NO — still exists!"}`
    );
  }

  const isClean =
    remainingUsers.length === 1 &&
    remainingUsers[0].email === KEEP_EMAIL &&
    remainingDoomedCompanies === 0 &&
    orphanEmployees === 0 &&
    orphanCustomers === 0 &&
    orphanProjects === 0 &&
    orphanInvitations === 0;

  if (!isClean) {
    console.error("VERIFICATION FAILED — database may be in an inconsistent state. Investigate immediately.");
    process.exit(1);
  }

  console.log("VERIFICATION PASSED. Cleanup complete.");
  process.exit(0);
}

// Sentinel error used only to force the dry-run transaction to roll back
// after computing real counts.
class DryRunRollback extends Error {}

main()
  .catch((error) => {
    console.error("FAILED — transaction rolled back, no data was changed.");
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
