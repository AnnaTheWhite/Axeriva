import prisma from "../../database/prisma";
import type { ProjectActivityType } from "../../constants/projectActivity";

type LogProjectActivityInput = {
  projectId: number;
  userId: number;
  type: ProjectActivityType;
  metadata?: Record<string, unknown>;
};

// A logging failure should never break the action it's recording — same
// fire-and-forget contract as logAudit (see services/audit/auditLog.ts).
export async function logProjectActivity({
  projectId,
  userId,
  type,
  metadata,
}: LogProjectActivityInput): Promise<void> {
  try {
    await prisma.projectActivity.create({
      data: {
        projectId,
        userId,
        type,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (error) {
    console.error("[project-activity] failed to write activity entry", type, error);
  }
}
