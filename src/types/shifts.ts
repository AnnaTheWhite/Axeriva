export type Shift = {
id: number;

employeeId: number;
projectId: number | null;

start: string;
end: string;

notes: string | null;

employee?: {
id: number;
firstName: string;
lastName: string;
};

project?: {
id: number;
name: string;
};

createdAt: string;
updatedAt: string;
};
