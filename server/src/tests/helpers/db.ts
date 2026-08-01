import prisma from "../../database/prisma";

// Delete order matters: children before parents, or the foreign keys reject
// the delete. Kept as an explicit list rather than something clever and
// reflective — when a model is added to schema.prisma, this list is the one
// place that must be updated, and a forgotten entry surfaces immediately as
// an FK error in the very next test run.
const DELETE_ORDER = [
  // N1.1 notification module — children before parents: EmailEvent →
  // NotificationDelivery/Notification → NotificationEvent → Company.
  () => prisma.emailEvent.deleteMany(),
  () => prisma.notificationDelivery.deleteMany(),
  () => prisma.notification.deleteMany(),
  () => prisma.notificationEvent.deleteMany(),
  () => prisma.notificationPreference.deleteMany(),
  () => prisma.emailSuppression.deleteMany(),
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
  // No FK relations — order is irrelevant, listed last for clarity.
  () => prisma.processedStripeEvent.deleteMany(),
];

export async function resetDatabase() {
  for (const remove of DELETE_ORDER) {
    await remove();
  }

  await resetQueue();
}

// N1.7.2 — the queue is part of "every test starts from an empty database",
// and it was not being reset.
//
// pg-boss owns the `pgboss` schema, which contains no Prisma models, so the
// list above never touched it: enqueued jobs SURVIVED between tests and, worse,
// between test FILES. A file that enqueued work therefore handed the next file
// a queue full of jobs referencing rows that had since been truncated — the
// workers picked them up, threw "delivery N not found", and burned their
// concurrency retrying ghosts while the test that was actually running timed
// out waiting for its own job.
//
// That was not hypothetical: notificationPipeline.test.ts passed alone and
// failed when notificationRecovery.test.ts ran before it, which is the worst
// kind of flake — order-dependent and invisible in a single-file run.
//
// DELETE rather than TRUNCATE: pg-boss v12 partitions `job` per queue, and a
// plain DELETE on the parent cascades to the partitions without taking the
// heavier lock. Guarded, because most test files never start the queue at all
// and the schema legitimately may not exist yet.
async function resetQueue() {
  try {
    await prisma.$executeRawUnsafe("DELETE FROM pgboss.job");
  } catch {
    // No pgboss schema in this run — nothing to clean.
  }
}
