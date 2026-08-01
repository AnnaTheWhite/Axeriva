import { Button, Section } from "@react-email/components";
import { type EmailBranding, ctaColors, theme } from "./theme";

// N1.3 — the single primary call to action. Exactly one per email: that is
// the rule the billing UX spec already set for every notification, and it is
// what keeps a transactional message unambiguous.
//
// Escaping is no longer hand-rolled: React escapes the label and the href
// attribute, which is what retires utils/escapeHtml.ts along with the old
// string templates.
export type CtaButtonProps = {
  label: string;
  url: string;
  branding?: EmailBranding;
};

export function CtaButton({ label, url, branding }: CtaButtonProps) {
  // Axeriva default → today's exact colours; a company colour → contrast-checked
  // text, so a pale brand cannot produce an unreadable button. See ctaColors().
  const { background, text } = ctaColors(branding);

  return (
    <Section style={{ margin: "24px 0" }}>
      <Button
        href={url}
        style={{
          backgroundColor: background,
          borderRadius: theme.size.buttonRadius,
          color: text,
          display: "inline-block",
          padding: "12px 24px",
          textDecoration: "none",
          fontWeight: "bold",
          fontSize: "14px",
        }}
      >
        {label}
      </Button>
    </Section>
  );
}
