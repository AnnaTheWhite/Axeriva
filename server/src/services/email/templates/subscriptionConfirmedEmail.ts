import { emailLayout } from "./layout";
import { escapeHtml } from "../../../utils/escapeHtml";

export type SubscriptionConfirmedEmailData = {
  companyName: string;
  planName: string;
};

export function subscriptionConfirmedEmailTemplate({
  companyName,
  planName,
}: SubscriptionConfirmedEmailData) {
  // `companyName` is tenant-supplied. `planName` is server-derived today, but
  // it is escaped too so this template never depends on where its inputs came
  // from — the same rule for every interpolated value.
  const safeCompanyName = escapeHtml(companyName);
  const safePlanName = escapeHtml(planName);

  const subject = `Your ${planName} subscription is active`;

  const html = emailLayout(`
    <p style="margin:0 0 16px;">Thanks for subscribing!</p>
    <p style="margin:0 0 16px;">
      <strong>${safeCompanyName}</strong> is now on the <strong>${safePlanName}</strong>
      plan. You have full access to employees, projects, scheduling, and
      time tracking.
    </p>
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">
      You can manage or cancel your subscription anytime from the
      Subscription page in Axeriva.
    </p>
  `);

  const text = `Thanks for subscribing!\n\n${companyName} is now on the ${planName} plan. You have full access to employees, projects, scheduling, and time tracking.\n\nYou can manage or cancel your subscription anytime from the Subscription page in Axeriva.`;

  return { subject, html, text };
}
