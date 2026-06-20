export type Customer = {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  projects?: {
    id: number;
    name: string;
    status: string;
  }[];
  createdAt?: string;
  updatedAt?: string;
};