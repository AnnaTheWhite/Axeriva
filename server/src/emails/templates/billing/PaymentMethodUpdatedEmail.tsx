import { Text } from "@react-email/components";
import { BaseLayout } from "../../components/BaseLayout";
import { InfoPanel, InfoRow } from "../../components/InfoRow";
import type { EmailBranding } from "../../components/theme";
import { theme } from "../../components/theme";
import { renderEmail, type RenderedEmail } from "../../render";
// Aliased so the module-level lookup the brand helpers need cannot be confused
// with the per-locale `t` every template body binds from translator().
import { t as translateKey, translator } from "../../../i18n";
import type { NotificationLocale } from "../../../constants/notifications";

// N1.8 Slice 5 — the card-on-file notice, sent when Stripe attaches a payment
// method to a customer who already has a live subscription
// (payment_method.attached).
//
// THREE THINGS ABOUT THIS ONE ARE LOAD-BEARING.
//
// 1. IT PRINTS EXACTLY TWO FACTS ABOUT THE CARD, and the payload cannot carry a
//    third. Stripe's card object also holds exp_month, exp_year, country,
//    funding and a fingerprint; brand and last4 are the two a customer needs to
//    recognise their own card, and the two that may be shown. Anything more
//    would make this email — and the NotificationEvent row behind it — worth
//    stealing. The expiry is the tempting one and is deliberately absent: the
//    expiring-card message is `billing.card_expiring`, which K3 left out of
//    N1.8 entirely, and half-implementing it here as a printed date would be
//    the worst of both.
//
// 2. IT ASSERTS A CHANGE, NOT A STATE. "This is the card we will charge from
//    now on" is provable from the payload; "this is the only card on your
//    account" is not, and Stripe's Customer Portal can leave an old method
//    attached. So the copy is forward-looking and never counts cards.
//
// 3. IT ASKS "WAS THIS YOU?" WITHOUT A LINK. The payload carries no URL by
//    design (the plan's PaymentMethodEmailData is brand + last4), so the closing
//    line names the Subscription page in words — the same choice Slice 4 made,
//    and for the stronger reason here: a one-click CTA in a mail that announces a
//    billing change is exactly the shape a phisher copies.
export type PaymentMethodUpdatedEmailProps = {
  companyName: string;
  // Stripe's raw card.brand token, lowercase ("visa", "amex", "unknown").
  brand: string;
  // The last four digits, as a string — "0042" is a real ending.
  last4: string;
  locale: NotificationLocale;
  branding?: EmailBranding;
};

// Stripe's documented brand tokens (PaymentMethods.d.ts:50 — "Can be `amex`,
// `cartes_bancaires`, `diners`, `discover`, `eftpos_au`, `jcb`, `link`,
// `mastercard`, `unionpay`, `visa` or `unknown`") mapped to how each brand
// writes its own name.
//
// NOT IN THE i18n CATALOGUES, deliberately: these are proper nouns that read
// identically in both languages, and putting them there would be twenty-two
// keys whose two sides must never differ — a parity test with nothing to catch,
// and an invitation to "translate" a trademark. The one string that IS
// language-dependent is the fallback, and that one is a catalogue key.
//
// The map is exhaustive against the SDK's list TODAY, and `unknown` is
// deliberately absent from it rather than mapped to some placeholder: it takes
// the same fallback as a brand Stripe adds after this was written, because the
// two mean the same thing to a reader.
const CARD_BRAND_NAMES: Record<string, string> = {
  amex: "American Express",
  cartes_bancaires: "Cartes Bancaires",
  diners: "Diners Club",
  discover: "Discover",
  eftpos_au: "eftpos Australia",
  jcb: "JCB",
  link: "Link",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
};

// "Visa" / "American Express" / "Card" — never the raw token. A subject line
// reading "Your Axeriva payment method was updated — visa •••• 4242" is the
// visible symptom of a brand token reaching the customer, and the lowercase is
// the only thing that gives it away.
export function cardBrandName(brand: string, locale: NotificationLocale): string {
  return (
    CARD_BRAND_NAMES[brand.trim().toLowerCase()] ??
    translateKey(locale, "billing.common.cardGeneric")
  );
}

// The one string this email is about. Built here rather than in the channel so
// the subject and the panel row cannot drift apart, and so the masking is in one
// place: four bullets are typography, not data, and must never come from last4.
export function cardLabel(brand: string, last4: string, locale: NotificationLocale): string {
  return `${cardBrandName(brand, locale)} •••• ${last4}`;
}

export function PaymentMethodUpdatedEmail({
  companyName,
  brand,
  last4,
  locale,
  branding,
}: PaymentMethodUpdatedEmailProps) {
  const t = translator(locale);
  const card = cardLabel(brand, last4, locale);

  return (
    <BaseLayout locale={locale} footerText={t("common.footerTagline")} branding={branding}>
      <Text style={{ margin: "0 0 16px" }}>{t("billing.paymentMethodUpdated.intro")}</Text>
      <Text style={{ margin: "0 0 16px" }}>
        {t("billing.paymentMethodUpdated.body", { companyName })}
      </Text>

      <InfoPanel>
        {/* One row, emphasised: it is the entire content of the message. */}
        <InfoRow label={t("billing.common.paymentMethod")} value={card} emphasis />
      </InfoPanel>

      <Text
        className="ax-muted"
        style={{ margin: "16px 0 0", color: theme.color.mutedText, fontSize: theme.font.small }}
      >
        {t("billing.paymentMethodUpdated.checkNote")}
      </Text>
    </BaseLayout>
  );
}

export function paymentMethodUpdatedEmailTemplate(
  props: PaymentMethodUpdatedEmailProps
): Promise<RenderedEmail> {
  const t = translator(props.locale);
  return renderEmail(
    t("billing.paymentMethodUpdated.subject", {
      card: cardLabel(props.brand, props.last4, props.locale),
    }),
    <PaymentMethodUpdatedEmail {...props} />
  );
}
