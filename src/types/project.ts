export type Project = {
  id: number;
  name: string;
  description?: string;
  status: string;
  deadline?: string;
  customerId?: number | null;
  customer?: {
    id: number;
    name: string;
  };
  assignments?: {
    id: number;
    employee: {
      id: number;
      firstName: string;
      lastName: string;
    };
  }[];
  createdAt?: string;
  updatedAt?: string;
};