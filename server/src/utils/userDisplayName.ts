type UserWithEmployee = {
  email: string;
  employee?: { firstName: string; lastName: string } | null;
};

// BUSINESS_OWNER/DEVELOPER accounts have no linked Employee record, so they
// fall back to their email — same convention used for activity feeds
// elsewhere (e.g. AuditLog only stores a userId and leaves display naming
// to the consumer).
export function userDisplayName(user: UserWithEmployee): string {
  if (user.employee) {
    return `${user.employee.firstName} ${user.employee.lastName}`;
  }

  return user.email;
}
