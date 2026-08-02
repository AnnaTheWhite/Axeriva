import { Column, Row, Section, Text } from "@react-email/components";
import { theme } from "./theme";

// N1.8 Fázis 0 — the label/value row the plan's §5.1 named and N1.3 never
// built. It is the backbone of all twelve billing emails: amount, billing
// period, plan, next charge, card — every one of them is a label on the left
// and a value on the right.
//
// A TABLE, not flexbox. Outlook's rendering engine is Word, which ignores
// flex and grid entirely; @react-email/components' Row/Column emit table
// markup, which is the only layout primitive that survives every mail client.
// This is why an email component library exists at all.

export type InfoRowProps = {
  label: string;
  value: string;
  // Draws attention to one row — the amount due on a failed payment, say.
  // Deliberately not a colour: the theme's accent is the CTA's, and a second
  // coloured element competes with the single-primary-action rule the billing
  // UX spec sets. Emphasis is weight, not hue.
  emphasis?: boolean;
};

export function InfoRow({ label, value, emphasis = false }: InfoRowProps) {
  return (
    <Row style={{ marginBottom: "8px" }}>
      <Column style={{ verticalAlign: "top" }}>
        <Text
          style={{
            margin: 0,
            color: theme.color.mutedText,
            fontSize: theme.font.small,
            fontFamily: theme.font.family,
          }}
        >
          {label}
        </Text>
      </Column>
      {/* Right-aligned so a column of amounts lines up on the decimal-ish edge,
          which is what makes a receipt scannable. */}
      <Column style={{ verticalAlign: "top", textAlign: "right" }}>
        <Text
          style={{
            margin: 0,
            color: theme.color.bodyText,
            fontSize: emphasis ? theme.font.body : theme.font.small,
            fontWeight: emphasis ? "bold" : "normal",
            fontFamily: theme.font.family,
          }}
        >
          {value}
        </Text>
      </Column>
    </Row>
  );
}

// A bordered block of InfoRows — the receipt panel. Separated from InfoRow so a
// template can also drop a single row into running text without the chrome.
export function InfoPanel({ children }: { children: React.ReactNode }) {
  return (
    <Section
      style={{
        backgroundColor: theme.color.footerBackground,
        border: `1px solid ${theme.color.cardBorder}`,
        borderRadius: theme.size.buttonRadius,
        padding: "16px",
        margin: "20px 0",
      }}
    >
      {children}
    </Section>
  );
}
