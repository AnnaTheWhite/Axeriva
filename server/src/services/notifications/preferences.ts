import prisma from "../../database/prisma";
import {
  CONFIGURABLE_CATEGORIES,
  CONFIGURABLE_CHANNELS,
  MANDATORY_CATEGORIES,
  OPT_IN_CATEGORIES,
  VISIBLE_CATEGORIES,
  defaultEnabledForCategory,
  isNotificationCategory,
  isNotificationChannel,
  type NotificationCategory,
  type NotificationChannel,
} from "../../constants/notifications";

// N1.7 — the read and write side of the three-level preference model
// (plan §7.1), in one module so the resolution order can only be written once:
//
//   user row (userId set) → company default (userId null) → registry default
//
// The GATE (gates.ts) answers "may this send happen?" for one notification at
// one instant. This module answers "what will happen, and who decided it?" for
// every category at once — that is what a preference screen has to show, and
// it is why the response carries all three levels rather than just the winner.
// Both consult defaultEnabledForCategory() for step three, so the screen and
// the sender cannot disagree about an opt-in category.

export type ChannelResolution = {
  // What the chain resolves to. NOT the same as "will be delivered": the three
  // Company toggles sit in front of this and are reported in `blockedBy`.
  effective: boolean;
  // Each level, null when that level has no opinion. The UI renders the
  // winner and can say where it came from ("inherited from company default").
  user: boolean | null;
  company: boolean | null;
  registry: boolean;
  // Which company toggle would suppress this channel regardless of the chain
  // above, mirroring evaluateCompanyToggles() in gates.ts. Mandatory
  // categories ignore the toggles entirely, so this stays null for them.
  blockedBy: "company_notifications_off" | "company_channel_off" | null;
};

export type CategoryResolution = {
  category: NotificationCategory;
  // Q2: security and critical billing cannot be switched off by any row. Shown
  // locked-on rather than hidden — see VISIBLE_CATEGORIES.
  mandatory: boolean;
  // digest + marketing: off until explicitly enabled.
  optIn: boolean;
  channels: Record<string, ChannelResolution>;
};

export type ResolvedPreferences = {
  channels: readonly NotificationChannel[];
  categories: CategoryResolution[];
  company: {
    notificationsEnabled: boolean;
    emailNotificationsEnabled: boolean;
    desktopNotificationsEnabled: boolean;
  } | null;
};

export type PreferenceUpdate = {
  category: NotificationCategory;
  channel: NotificationChannel;
  // null clears the row, dropping this scope back to the level below —
  // "inherit" is a real state, distinct from "explicitly on".
  enabled: boolean | null;
};

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export class PreferenceValidationError extends Error {}

// The allow-list the plan's API table demands. Rejects rather than silently
// drops: a save that answers 200 while ignoring half the payload trains users
// to distrust the screen.
export function parsePreferenceUpdates(input: unknown): PreferenceUpdate[] {
  const raw = (input as { preferences?: unknown } | null)?.preferences;

  if (!Array.isArray(raw)) {
    throw new PreferenceValidationError("preferences must be an array");
  }
  if (raw.length === 0) {
    throw new PreferenceValidationError("preferences must not be empty");
  }
  // A bound on how much one request can rewrite. The full matrix is
  // categories × channels; anything beyond it is a malformed or hostile body.
  if (raw.length > VISIBLE_CATEGORIES.length * CONFIGURABLE_CHANNELS.length) {
    throw new PreferenceValidationError("too many preference entries");
  }

  return raw.map((entry) => {
    const { category, channel, enabled } = (entry ?? {}) as Record<string, unknown>;

    if (!isNotificationCategory(category)) {
      throw new PreferenceValidationError(`unknown category: ${String(category)}`);
    }
    // Mandatory categories are refused, not clamped. Accepting the write and
    // storing enabled=false would leave a row claiming something the gate will
    // never honour — and the next person to read the table would believe it.
    if (MANDATORY_CATEGORIES.includes(category)) {
      throw new PreferenceValidationError(`${category} notifications cannot be switched off`);
    }
    if (!CONFIGURABLE_CATEGORIES.includes(category)) {
      throw new PreferenceValidationError(`category is not configurable: ${category}`);
    }
    if (!isNotificationChannel(channel) || !CONFIGURABLE_CHANNELS.includes(channel)) {
      throw new PreferenceValidationError(`unknown channel: ${String(channel)}`);
    }
    if (enabled !== null && typeof enabled !== "boolean") {
      throw new PreferenceValidationError("enabled must be a boolean or null");
    }

    return { category, channel, enabled };
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function resolvePreferences(
  companyId: number | null,
  userId: number
): Promise<ResolvedPreferences> {
  // A DEVELOPER belongs to no company, so there is no row to read and nothing
  // to write. They still get the registry view rather than an error: the
  // screen renders, it is simply all defaults.
  const [rows, company] = await Promise.all([
    companyId === null
      ? Promise.resolve([])
      : prisma.notificationPreference.findMany({
          where: { companyId, OR: [{ userId }, { userId: null }] },
          orderBy: { id: "asc" },
        }),
    companyId === null
      ? Promise.resolve(null)
      : prisma.company.findUnique({
          where: { id: companyId },
          select: {
            notificationsEnabled: true,
            emailNotificationsEnabled: true,
            desktopNotificationsEnabled: true,
          },
        }),
  ]);

  const categories = VISIBLE_CATEGORIES.map<CategoryResolution>((category) => {
    const mandatory = MANDATORY_CATEGORIES.includes(category);
    const channels: Record<string, ChannelResolution> = {};

    for (const channel of CONFIGURABLE_CHANNELS) {
      const forSlot = rows.filter((row) => row.category === category && row.channel === channel);
      // Ordered by id above, so the first company-default row wins — the same
      // deterministic tie-break gates.ts applies.
      const userRow = forSlot.find((row) => row.userId === userId);
      const companyRow = forSlot.find((row) => row.userId === null);
      const registry = defaultEnabledForCategory(category);

      channels[channel] = {
        effective: mandatory ? true : userRow?.enabled ?? companyRow?.enabled ?? registry,
        user: mandatory ? null : userRow?.enabled ?? null,
        company: mandatory ? null : companyRow?.enabled ?? null,
        registry: mandatory ? true : registry,
        blockedBy: mandatory ? null : companyToggleBlock(channel, company),
      };
    }

    return {
      category,
      mandatory,
      optIn: OPT_IN_CATEGORIES.includes(category),
      channels,
    };
  });

  return { channels: CONFIGURABLE_CHANNELS, categories, company };
}

function companyToggleBlock(
  channel: NotificationChannel,
  company: ResolvedPreferences["company"]
): ChannelResolution["blockedBy"] {
  if (!company) return null;
  if (!company.notificationsEnabled) return "company_notifications_off";
  if (channel === "EMAIL" && !company.emailNotificationsEnabled) return "company_channel_off";
  return null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

// The user's own overrides. These rows ARE covered by the composite unique
// (userId is non-null), so a plain upsert is race-safe: two concurrent saves
// of the same slot collide on the constraint instead of producing two rows.
export async function setUserPreferences(
  companyId: number,
  userId: number,
  updates: PreferenceUpdate[]
): Promise<void> {
  await prisma.$transaction(
    updates.map(({ category, channel, enabled }) =>
      enabled === null
        ? prisma.notificationPreference.deleteMany({
            where: { companyId, userId, category, channel },
          })
        : prisma.notificationPreference.upsert({
            where: {
              companyId_userId_category_channel: { companyId, userId, category, channel },
            },
            update: { enabled },
            create: { companyId, userId, category, channel, enabled },
          })
    )
  );
}

// The company default (userId = null), owner-only.
//
// Deliberately delete-then-create rather than upsert, and this is the direct
// consequence of the N1.1 known limitation: PostgreSQL treats NULLs in a unique
// index as distinct, so `@@unique([companyId, userId, category, channel])` does
// NOT constrain these rows and Prisma's generated compound-unique input types
// `userId` as non-nullable — there is no upsert to reach for. Delete-then-create
// inside one transaction both writes the new value AND collapses any duplicate
// pair a previous race left behind, so the table self-heals on every save
// instead of accumulating rows the resolver has to guess between. The cost is a
// fresh id and createdAt per save, which for a settings row buys nothing to
// preserve. (PG 15's NULLS NOT DISTINCT and a partial unique index were both
// rejected at N1.1: neither is expressible in the Prisma schema, so either
// would break the drift check.)
export async function setCompanyDefaults(
  companyId: number,
  updates: PreferenceUpdate[]
): Promise<void> {
  await prisma.$transaction(
    updates.flatMap(({ category, channel, enabled }) => {
      const clear = prisma.notificationPreference.deleteMany({
        where: { companyId, userId: null, category, channel },
      });

      return enabled === null
        ? [clear]
        : [
            clear,
            prisma.notificationPreference.create({
              data: { companyId, userId: null, category, channel, enabled },
            }),
          ];
    })
  );
}
