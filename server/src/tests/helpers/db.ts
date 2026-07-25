import prisma from "../../database/prisma";

// Delete order matters: children before parents, or the foreign keys reject
// the delete. Kept as an explicit list rather than something clever and
// reflective — when a model is added to schema.prisma, this list is the one
// place that must be updated, and a forgotten entry surfaces immediately as
// an FK error in the very next test run.
const DELETE_ORDER = [
  () => prisma.ownerNoteConversion.deleteMany(),
  () => prisma.projectInternalNote.deleteMany(),
  () => prisma.communicationLog.deleteMany(),
  () => prisma.reminder.deleteMany(),
  () => prisma.task.deleteMany(),
  () => prisma.ownerNote.deleteMany(),
  () => prisma.projectActivity.deleteMany(),
  () => prisma.projectAttachment.deleteMany(),
  () => prisma.projectNote.deleteMany(),
  () => prisma.projectAssignment.deleteMany(),
  () => prisma.shift.deleteMany(),
  () => prisma.invitation.deleteMany(),
  () => prisma.auditLog.deleteMany(),
  // User references both Employee and Company, so it goes before them.
  () => prisma.user.deleteMany(),
  () => prisma.project.deleteMany(),
  () => prisma.employee.deleteMany(),
  () => prisma.customer.deleteMany(),
  () => prisma.company.deleteMany(),
];

export async function resetDatabase() {
  for (const remove of DELETE_ORDER) {
    await remove();
  }
}
