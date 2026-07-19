# Company Management (C1)

The Company Management module makes the `Company` record the single source of
truth for all company-level settings: profile, branding, localization,
preferences, export, and archival. It reuses the existing authentication,
role, subscription (read-only mode), upload, and i18n systems — no business
logic is duplicated.

## Architecture

### Backend

| Piece | File | Purpose |
|---|---|---|
| Settings routes | `server/src/routes/company.routes.ts` | GET/PUT `/company/settings`, POST/DELETE `/company/logo`, GET `/company/export` |
| Archive route | `server/src/routes/companyArchive.routes.ts` | POST `/company/archive` (mounted separately, see Archive flow) |
| Field validation | `server/src/services/companyValidation.ts` | Centralized server-side validation for every writable field |
| Logo processing | `server/src/services/companyLogo.ts` | sharp-based validation/resize, SVG sanity check, disk cleanup |
| Upload middleware | `server/src/middleware/upload.middleware.ts` | Shared multer factory; `uploadCompanyLogo` (2 MB, PNG/JPG/SVG) |
| Schema | `server/prisma/schema.prisma` (`Company` model) | All settings columns |

Route mounting (`server/src/index.ts`):

- `/company` is mounted behind `tenantWrite` (auth + S2.7 read-only write
  guard), so all settings writes are blocked while a subscription has lapsed.
- `/company/archive` is mounted **before** it with plain `authMiddleware`
  only — an owner with a lapsed subscription must still be able to archive,
  mirroring the existing `/subscription` bypass precedent.

Writes never spread `req.body` into Prisma. `PUT /company/settings` copies
only the keys listed in the `WRITABLE_FIELDS` allowlist, so `id`, `active`,
`stripeCustomerId`, plan fields etc. cannot be mass-assigned.

### Frontend

| Piece | File |
|---|---|
| Page assembly | `src/pages/SettingsPage.tsx` |
| Profile section | `src/components/company/CompanyProfileSection.tsx` |
| Branding section | `src/components/company/BrandingSection.tsx` |
| Localization section | `src/components/company/LocalizationSection.tsx` |
| Preferences section | `src/components/company/PreferencesSection.tsx` |
| Danger zone | `src/components/account/DangerZoneSection.tsx` + `src/components/company/ArchiveCompanyModal.tsx` |
| API service | `src/services/companySettings.service.ts` |
| Owner check | `src/hooks/useIsOwner.ts` |

Client-side validation in the sections is UX-only; the server re-validates
everything (`companyValidation.ts` returns per-field errors that the UI
surfaces under each input).

## Permissions

This codebase has three roles: `BUSINESS_OWNER`, `EMPLOYEE`, `DEVELOPER`.
There is no separate "Manager" role, so the requested
Owner / Manager / Employee tiers map as:

| Requested tier | Actual role | Access |
|---|---|---|
| Owner | `BUSINESS_OWNER` | Full read/write on every company endpoint |
| Manager, Employee | `EMPLOYEE` | Read-only: GET `/company/settings` and GET `/company/export` return 200; every write (PUT settings, logo upload/delete, archive) returns 403 |
| — | `DEVELOPER` | Platform admin; may read/write any company via `?companyId=` |

Enforcement is server-side per route (`requireRole` on each write route).
The UI mirrors it: `useIsOwner()` disables inputs, hides Save buttons and
the Danger Zone for employees, and shows a read-only notice — but the server
is the real gate.

Archiving is stricter: `POST /company/archive` accepts `BUSINESS_OWNER`
only (not `DEVELOPER`, which has its own admin tooling).

## Branding

Branding consists of three values on `Company`: `logoUrl`, `primaryColor`,
`accentColor` (hex, validated server-side).

- **Logo storage**: `server/uploads/logos/<uuid>.<ext>`, served via the
  existing `/uploads` static mount. The DB stores the root-relative path;
  clients build the absolute URL with `companyLogoUrl()` in
  `companySettings.service.ts`. That helper also transparently supports
  legacy base64 `data:` logos from before this module — no migration needed.
- **Upload pipeline**: multer (MIME allowlist + 2 MB cap) → sharp
  re-encode. Raster images are decoded (rejecting content that merely claims
  an image MIME), resized to fit 512×512, and always re-encoded to PNG. SVGs
  get a structural sanity check. The previous logo file is deleted from disk
  only after the replacement is confirmed valid.
- **Consumption**: anything that needs branding reads it from
  `GET /company/settings` (dashboard, PDF exports, and future emails/reports
  should all read these fields rather than keeping copies).

## Localization

Fields: `language`, `currency`, `timezone`, `dateFormat` (`yyyy-MM-dd`,
`dd/MM/yyyy`, `MM/dd/yyyy`), `timeFormat` (`24h`/`12h`).

Saving a language the app has dictionaries for (`en`, `hu`) immediately
flips the current session's UI via the existing `LanguageProvider`
(`setLanguage()`), fulfilling "changing settings must immediately update the
UI". Other locales are stored for document/formatting use. Timezone accepts
any well-formed IANA name server-side; the picker offers a curated common
subset.

## Company Preferences

Fields: `firstDayOfWeek` (0–6), `defaultWorkStart`/`defaultWorkEnd`
(HH:mm), `defaultShiftMinutes` (1–1440), and three notification toggles
(`notificationsEnabled` master + email/desktop, which the UI disables when
the master toggle is off). All validated server-side and persisted on the
company row.

## Export format

`GET /company/export` returns downloadable JSON
(`Content-Disposition: attachment`):

```json
{
  "version": 1,
  "exportedAt": "2026-07-19T15:38:20.292Z",
  "company": { "id": 76, "name": "…", "…": "all settings fields" }
}
```

`version` is the future-compatibility handle: additive changes keep
`version: 1`; breaking shape changes bump it so future importers can branch
on it.

## Archive flow (C1.7)

Archiving reuses the existing `Company.active` / `deletedAt` fields and the
auth middleware's company-inactive check — no new mechanism.

1. Owner opens Settings → Danger Zone → "Archive company".
2. Confirmation modal (`ArchiveCompanyModal`) requires the owner's password
   **and** typing `ARCHIVE` (same pattern as account deletion).
3. `POST /company/archive` verifies role + password + confirmation, then
   sets `active: false, deletedAt: now` on the company and writes a
   `COMPANY_ARCHIVED` audit entry.
4. Every subsequent login or authenticated request from any user of that
   company is rejected by `auth.middleware.ts` (company-inactive → 401), so
   login is disabled for the whole company at once.

Nothing is deleted: company row, users, employees, projects, customers,
invoices, Stripe customer/subscription history are all preserved. User rows
are not modified, so un-archiving (support operation: set `active: true`,
clear `deletedAt`) restores access without data loss.

Note: like the existing delete-account flow, a wrong password returns 401,
which the global `apiFetch` handler treats as session-invalid (logs the
user out). Pre-existing behavior shared with account deletion.
