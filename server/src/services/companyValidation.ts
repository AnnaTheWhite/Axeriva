// C1.1/C1.3/C1.4/C1.5 — the ONE place Company profile/branding/localization/
// preference fields are validated server-side. Consumed only by
// routes/company.routes.ts's PUT /settings; no route re-implements these
// checks. Frontend validation (CompanyProfileSection etc.) is UX only — this
// is the real gate, exactly as required ("never trust frontend validation").

export type FieldErrors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/;

const VALID_DATE_FORMATS = ["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"] as const;
const VALID_TIME_FORMATS = ["24h", "12h"] as const;

// Loose but real IANA-timezone-name shape check (e.g. "Europe/Budapest",
// "UTC", "America/New_York") — full tz-database validation would need a new
// dependency; this catches garbage input without one.
const TIMEZONE_RE = /^[A-Za-z_]+(\/[A-Za-z_]+)*$/;

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

// Validates a PUT /company/settings body. Every field is OPTIONAL (a partial
// update), but whatever IS present must be well-formed. Returns an empty
// object when everything provided is valid.
export function validateCompanySettings(body: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {};

  // --- C1.1 Profile ---------------------------------------------------
  if ("name" in body && isBlank(body.name)) {
    errors.name = "Company name is required.";
  }
  if ("contactEmail" in body && body.contactEmail && !EMAIL_RE.test(String(body.contactEmail))) {
    errors.contactEmail = "Enter a valid email address.";
  }
  if ("billingEmail" in body && body.billingEmail && !EMAIL_RE.test(String(body.billingEmail))) {
    errors.billingEmail = "Enter a valid email address.";
  }
  if ("website" in body && body.website && !URL_RE.test(String(body.website))) {
    errors.website = "Enter a valid URL (starting with http:// or https://).";
  }

  // --- C1.3 Branding ----------------------------------------------------
  if ("primaryColor" in body && body.primaryColor && !HEX_COLOR_RE.test(String(body.primaryColor))) {
    errors.primaryColor = "Enter a valid hex color (e.g. #F97316).";
  }
  if ("accentColor" in body && body.accentColor && !HEX_COLOR_RE.test(String(body.accentColor))) {
    errors.accentColor = "Enter a valid hex color (e.g. #F97316).";
  }

  // --- C1.4 Localization -------------------------------------------------
  if ("dateFormat" in body && body.dateFormat && !VALID_DATE_FORMATS.includes(body.dateFormat as never)) {
    errors.dateFormat = `dateFormat must be one of: ${VALID_DATE_FORMATS.join(", ")}.`;
  }
  if ("timeFormat" in body && body.timeFormat && !VALID_TIME_FORMATS.includes(body.timeFormat as never)) {
    errors.timeFormat = `timeFormat must be one of: ${VALID_TIME_FORMATS.join(", ")}.`;
  }
  if ("timezone" in body && body.timezone && !TIMEZONE_RE.test(String(body.timezone))) {
    errors.timezone = "Enter a valid timezone name (e.g. Europe/Budapest).";
  }
  if ("currency" in body && body.currency && !/^[A-Z]{3}$/.test(String(body.currency))) {
    errors.currency = "Currency must be a 3-letter code (e.g. EUR, HUF).";
  }
  if ("language" in body && body.language && !/^[a-z]{2}$/.test(String(body.language))) {
    errors.language = "Language must be a 2-letter code (e.g. en, hu).";
  }

  // --- C1.5 Preferences --------------------------------------------------
  if ("firstDayOfWeek" in body && body.firstDayOfWeek !== null && body.firstDayOfWeek !== undefined) {
    const day = Number(body.firstDayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      errors.firstDayOfWeek = "firstDayOfWeek must be an integer between 0 (Sunday) and 6 (Saturday).";
    }
  }
  if ("defaultWorkStart" in body && body.defaultWorkStart && !TIME_RE.test(String(body.defaultWorkStart))) {
    errors.defaultWorkStart = "Enter a valid time (HH:mm).";
  }
  if ("defaultWorkEnd" in body && body.defaultWorkEnd && !TIME_RE.test(String(body.defaultWorkEnd))) {
    errors.defaultWorkEnd = "Enter a valid time (HH:mm).";
  }
  if (
    "defaultShiftMinutes" in body &&
    body.defaultShiftMinutes !== null &&
    body.defaultShiftMinutes !== undefined
  ) {
    const minutes = Number(body.defaultShiftMinutes);
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) {
      errors.defaultShiftMinutes = "Default shift length must be a positive number of minutes (max 1440).";
    }
  }
  for (const key of ["notificationsEnabled", "emailNotificationsEnabled", "desktopNotificationsEnabled"]) {
    if (key in body && typeof body[key] !== "boolean") {
      errors[key] = `${key} must be true or false.`;
    }
  }

  return errors;
}
