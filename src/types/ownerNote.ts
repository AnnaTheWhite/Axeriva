export const OWNER_NOTE_STATUSES = ["Inbox", "Reviewed", "Archived"] as const;

export type OwnerNoteStatus = (typeof OWNER_NOTE_STATUSES)[number];

export type OwnerNote = {
  id: number;
  title: string;
  content: string;
  status: OwnerNoteStatus;
  companyId: number;
  userId: number;
  projectId: number | null;
  customerId: number | null;
  employeeId: number | null;
  project?: { id: number; name: string } | null;
  customer?: { id: number; name: string } | null;
  employee?: { id: number; firstName: string; lastName: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type DetectedEntities = {
  customers: { id: number; name: string }[];
  projects: { id: number; name: string }[];
  employees: { id: number; firstName: string; lastName: string }[];
};
