export const PROJECT_ACTIVITY_TYPES = {
  NOTE_CREATED: "NOTE_CREATED",
  FILE_UPLOADED: "FILE_UPLOADED",
  PHOTO_UPLOADED: "PHOTO_UPLOADED",
  CLOCK_IN: "CLOCK_IN",
  CLOCK_OUT: "CLOCK_OUT",
  // No task system exists yet in CrewFlow — reserved for when one does.
  TASK_COMPLETED: "TASK_COMPLETED",
} as const;

export type ProjectActivityType =
  (typeof PROJECT_ACTIVITY_TYPES)[keyof typeof PROJECT_ACTIVITY_TYPES];
