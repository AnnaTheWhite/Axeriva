import prisma from "../../database/prisma";
import { ROLES } from "../../constants/roles";
import { resolveLocale } from "../../i18n";
import type { NotificationLocale } from "../../constants/notifications";
import type { RecipientStrategy } from "./registry";

// N1.5 — who actually receives a notification, and in which language.
//
// Every strategy below applies the same three filters, because getting any of
// them wrong sends mail to someone who must not receive it:
//
//   active: true          a deactivated login is not a recipient
//   company.active: true  an archived company's users are locked out
//   tombstone check       POST /account/delete rewrites the address to
//                         `deleted+<id>+<ts>__<original>`; that string is a
//                         valid-looking address that would actually be sent to

export type ResolvedRecipient = {
  userId: number | null;
  email: string;
  locale: NotificationLocale;
};

// account.routes.ts builds tombstones as `deleted+<userId>+<epoch>__<email>`.
// Matching the prefix is enough and stays correct even if the suffix format
// changes.
const TOMBSTONE_PREFIX = /^deleted\+\d+\+\d+__/;

export function isTombstonedEmail(email: string): boolean {
  return TOMBSTONE_PREFIX.test(email);
}

type ResolveInput = {
  strategy: RecipientStrategy;
  companyId: number | null;
  context: Record<string, unknown>;
};

export async function resolveRecipients({
  strategy,
  companyId,
  context,
}: ResolveInput): Promise<ResolvedRecipient[]> {
  switch (strategy) {
    case "EMAIL":
      return resolveRawEmail(companyId, context);
    case "USER":
      return resolveUser(context);
    case "OWNER":
      return resolveUsers(companyId, ROLES.BUSINESS_OWNER);
    case "COMPANY_USERS":
      return resolveUsers(companyId, null);
    default:
      return [];
  }
}

// A recipient with no account yet: an invitee, or the address on a brand-new
// registration. The language comes from the company doing the inviting —
// which is the right signal, since that is the workspace they are joining.
async function resolveRawEmail(
  companyId: number | null,
  context: Record<string, unknown>
): Promise<ResolvedRecipient[]> {
  const email = typeof context.email === "string" ? context.email.trim() : "";
  if (!email || isTombstonedEmail(email)) return [];

  // If the address happens to belong to a real user, prefer their own
  // language over the company default.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, language: true, active: true, company: { select: { language: true } } },
  });

  const company =
    companyId === null
      ? null
      : await prisma.company.findUnique({
          where: { id: companyId },
          select: { language: true, active: true },
        });

  return [
    {
      userId: user?.active ? user.id : null,
      email,
      locale: resolveLocale({
        userLanguage: user?.language,
        companyLanguage: user?.company?.language ?? company?.language,
      }),
    },
  ];
}

async function resolveUser(context: Record<string, unknown>): Promise<ResolvedRecipient[]> {
  const userId = typeof context.userId === "number" ? context.userId : null;
  if (userId === null) return [];

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      language: true,
      active: true,
      company: { select: { language: true, active: true } },
    },
  });

  if (!user || !user.active || isTombstonedEmail(user.email)) return [];
  // A user whose company is archived is locked out of the product; mailing
  // them would be the one channel that still worked.
  if (user.company && !user.company.active) return [];

  return [
    {
      userId: user.id,
      email: user.email,
      locale: resolveLocale({
        userLanguage: user.language,
        companyLanguage: user.company?.language,
      }),
    },
  ];
}

async function resolveUsers(
  companyId: number | null,
  role: string | null
): Promise<ResolvedRecipient[]> {
  if (companyId === null) return [];

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { language: true, active: true },
  });
  if (!company || !company.active) return [];

  const users = await prisma.user.findMany({
    where: {
      companyId,
      active: true,
      ...(role ? { role } : {}),
    },
    select: { id: true, email: true, language: true },
  });

  return users
    .filter((user) => !isTombstonedEmail(user.email))
    .map((user) => ({
      userId: user.id,
      email: user.email,
      locale: resolveLocale({
        userLanguage: user.language,
        companyLanguage: company.language,
      }),
    }));
}
