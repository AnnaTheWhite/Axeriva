export const OWNER_NOTE_STATUSES = ["Inbox", "Reviewed", "Archived"] as const;

export type OwnerNoteStatus = (typeof OWNER_NOTE_STATUSES)[number];

export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

export type Priority = (typeof PRIORITIES)[number];

export const INTENT_TYPES = ["Task", "CommunicationLog", "Reminder", "ScheduleSuggestion"] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

// Kept broad so historical OwnerNoteConversion rows (created back when the
// Convert workflow was active) still render a label correctly. The Convert
// UI itself has been removed; this only feeds the read-only "✓ Converted"
// badge on note cards.
export const CONVERSION_TARGETS = ["Task", "Reminder", "CommunicationLog", "ProjectInternalNote"] as const;

export type ConversionTarget = (typeof CONVERSION_TARGETS)[number];

export type OwnerNoteConversion = {
  id: number;
  targetType: ConversionTarget;
  targetId: number;
  createdAt: string;
};

export type OwnerNote = {
  id: number;
  title: string;
  content: string;
  status: OwnerNoteStatus;
  priority: Priority;
  pinned: boolean;
  companyId: number;
  userId: number;
  projectId: number | null;
  customerId: number | null;
  employeeId: number | null;
  project?: { id: number; name: string } | null;
  customer?: { id: number; name: string } | null;
  employee?: { id: number; firstName: string; lastName: string } | null;
  conversions?: OwnerNoteConversion[];
  createdAt: string;
  updatedAt: string;
};

export type DetectedEntities = {
  customers: { id: number; name: string }[];
  projects: { id: number; name: string }[];
  employees: { id: number; firstName: string; lastName: string }[];
  intents: IntentType[];
};

export type OwnerNoteDashboard = {
  total: number;
  inbox: number;
  reviewed: number;
  archived: number;
  urgent: number;
  pinned: number;
};
