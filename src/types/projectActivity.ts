export type ProjectNote = {
  id: number;
  projectId: number;
  userId: number;
  userName: string;
  content: string;
  createdAt: string;
};

export type ProjectAttachment = {
  id: number;
  projectId: number;
  userId: number;
  userName: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  isImage: boolean;
  createdAt: string;
};

export const PROJECT_ACTIVITY_TYPES = {
  NOTE_CREATED: "NOTE_CREATED",
  FILE_UPLOADED: "FILE_UPLOADED",
  PHOTO_UPLOADED: "PHOTO_UPLOADED",
  CLOCK_IN: "CLOCK_IN",
  CLOCK_OUT: "CLOCK_OUT",
  TASK_COMPLETED: "TASK_COMPLETED",
} as const;

export type ProjectActivityType =
  (typeof PROJECT_ACTIVITY_TYPES)[keyof typeof PROJECT_ACTIVITY_TYPES];

export type ProjectActivityEntry = {
  id: number;
  projectId: number;
  userId: number;
  userName: string;
  type: ProjectActivityType;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};
