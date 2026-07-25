export type Employee = {
  id: number;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  status: string;
  // B1 — derived server-side from the linked User's active flag; true means
  // the login was revoked. Independent axis from `status` (availability).
  accessRevoked?: boolean;

  createdAt?: string;
  updatedAt?: string;
};