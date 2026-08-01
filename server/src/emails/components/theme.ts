// N1.3 — the email design tokens. Values carried over verbatim from the
// previous string-template layout (services/email/templates/layout.ts) so the
// React Email migration is a rendering change, not a redesign.

export const theme = {
  color: {
    pageBackground: "#f1f5f9",
    cardBackground: "#ffffff",
    cardBorder: "#e2e8f0",
    headerBackground: "#0f172a",
    headerText: "#ffffff",
    bodyText: "#1e293b",
    mutedText: "#64748b",
    footerBackground: "#f8fafc",
    footerText: "#94a3b8",
    accent: "#f97316",
    accentText: "#ffffff",
  },
  size: {
    card: "480px",
    radius: "16px",
    buttonRadius: "10px",
  },
  font: {
    family: "Helvetica, Arial, sans-serif",
    body: "15px",
    small: "13px",
    footer: "12px",
  },
} as const;

// Company branding, all optional. The capability lives here from N1.3 so the
// layout never needs reworking, but NO call site passes it yet — per-company
// branding activates at N1.5, where the dispatcher already loads the company
// row and can supply it without an extra query.
export type EmailBranding = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// A tenant-supplied colour is only trusted when it is a well-formed 6-digit
// hex. Anything else (empty, "red", "#fff", an injection attempt) falls back
// to the Axeriva accent rather than emitting a broken style attribute.
export function resolveAccentColor(branding?: EmailBranding): string {
  const candidate = branding?.primaryColor?.trim();
  return candidate && HEX_COLOR.test(candidate) ? candidate : theme.color.accent;
}

// The CTA's colours. The Axeriva default is returned VERBATIM rather than
// run through the contrast check below, deliberately: white-on-#f97316 is
// 2.83:1, which fails WCAG AA, and the check would silently flip the button
// text to dark — a visible redesign smuggled into a migration milestone. The
// existing palette is preserved here and the accessibility finding is raised
// separately, as a design decision.
//
// A company-supplied colour has no such history to preserve, so it does get
// the contrast treatment.
export function ctaColors(branding?: EmailBranding): { background: string; text: string } {
  const background = resolveAccentColor(branding);
  return background === theme.color.accent
    ? { background, text: theme.color.accentText }
    : { background, text: contrastTextColor(background) };
}

// Picks readable button text for an arbitrary brand colour. Without this a
// company whose brand is pale yellow would ship white-on-yellow CTAs that are
// invisible — the kind of defect nobody notices until a customer cannot find
// the button. Uses the standard sRGB relative-luminance formula.
export function contrastTextColor(backgroundHex: string): string {
  if (!HEX_COLOR.test(backgroundHex)) return theme.color.accentText;

  const channel = (start: number) => {
    const value = parseInt(backgroundHex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);

  // Contrast against white is (1.05 / (L + 0.05)); against near-black it is
  // ((L + 0.05) / 0.05). The crossover sits around L = 0.179.
  return luminance > 0.179 ? theme.color.bodyText : theme.color.accentText;
}

// Only http(s) logos are rendered. A data: or javascript: URL in an <img src>
// is both a client-compatibility problem and an injection surface, and the
// field is tenant-writable.
export function resolveLogoUrl(branding?: EmailBranding): string | null {
  const candidate = branding?.logoUrl?.trim();
  if (!candidate) return null;
  return /^https?:\/\//i.test(candidate) ? candidate : null;
}
