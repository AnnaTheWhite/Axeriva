import { Body, Container, Head, Html, Img, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";
import type { NotificationLocale } from "../../constants/notifications";
import { type EmailBranding, resolveLogoUrl, theme } from "./theme";

// N1.3 — the shared chrome every Axeriva email renders inside: header,
// content card, footer. Replaces the string-concatenating emailLayout() while
// keeping its exact visual output.
//
// Dark mode, honestly: React Email ships no dark-mode API or guidance, and
// email clients disagree. The <meta color-scheme> hints plus the
// prefers-color-scheme block below are respected by Apple Mail and
// Outlook.com; Gmail ignores them and applies its own colour inversion. That
// is why the palette avoids pure black text on pure white blocks and sets an
// explicit background on every container — those are what keep Gmail's
// inversion legible. Full parity across clients is not achievable and is not
// claimed; real-client testing is part of this milestone's exit criteria.
//
// The CSS below deliberately uses class selectors only (no ">" or "&"), so it
// survives React's text escaping inside <style> unchanged.
const darkModeCss = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ax-page { background-color: #0b1220 !important; }
    .ax-card { background-color: #111c31 !important; border-color: #1f2b45 !important; }
    .ax-content { color: #e2e8f0 !important; }
    .ax-muted { color: #94a3b8 !important; }
    .ax-footer { background-color: #0f1729 !important; }
  }
`;

export type BaseLayoutProps = {
  locale: NotificationLocale;
  // Footer tagline, already translated by the caller.
  footerText: string;
  branding?: EmailBranding;
  children: ReactNode;
};

export function BaseLayout({ locale, footerText, branding, children }: BaseLayoutProps) {
  const logoUrl = resolveLogoUrl(branding);

  return (
    // React Email's docs are explicit that lang/dir must be set on BOTH html
    // and body: several clients strip the outer element entirely.
    <Html lang={locale} dir="ltr">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{darkModeCss}</style>
      </Head>
      <Body
        lang={locale}
        dir="ltr"
        className="ax-page"
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: theme.color.pageBackground,
          fontFamily: theme.font.family,
        }}
      >
        <Section style={{ backgroundColor: theme.color.pageBackground, padding: "32px 0" }}>
          <Container
            className="ax-card"
            style={{
              width: theme.size.card,
              maxWidth: "100%",
              backgroundColor: theme.color.cardBackground,
              borderRadius: theme.size.radius,
              overflow: "hidden",
              border: `1px solid ${theme.color.cardBorder}`,
            }}
          >
            <Section
              style={{ backgroundColor: theme.color.headerBackground, padding: "24px 32px" }}
            >
              {logoUrl ? (
                <Img
                  src={logoUrl}
                  alt="Axeriva"
                  height="28"
                  style={{ height: "28px", width: "auto", display: "block" }}
                />
              ) : (
                <Text
                  style={{
                    margin: 0,
                    fontSize: "20px",
                    fontWeight: "bold",
                    color: theme.color.headerText,
                  }}
                >
                  Axeriva
                </Text>
              )}
            </Section>

            <Section
              className="ax-content"
              style={{
                padding: "32px",
                color: theme.color.bodyText,
                fontSize: theme.font.body,
                lineHeight: "1.6",
              }}
            >
              {children}
            </Section>

            <Section
              className="ax-footer"
              style={{ padding: "20px 32px", backgroundColor: theme.color.footerBackground }}
            >
              <Text
                className="ax-muted"
                style={{
                  margin: 0,
                  color: theme.color.footerText,
                  fontSize: theme.font.footer,
                }}
              >
                {footerText}
              </Text>
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
