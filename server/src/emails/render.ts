import { render } from "@react-email/render";
import type { ReactElement } from "react";

// N1.3 — the one place a React Email element becomes what the transport
// needs. Kept deliberately small: templates stay pure (props in, element
// out), and the EmailService keeps receiving the exact { subject, html, text }
// shape it already consumed, so the Resend/Mock implementations did not need
// restructuring for this migration.
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

// A plain-text alternative is generated for EVERY message, not as a nicety:
// some clients and some recipients refuse HTML outright, and a missing text
// part is itself a spam signal. Previously each template hand-wrote its own
// text version, which could (and did) drift from the HTML; deriving it from
// the rendered element removes that whole class of drift.
export async function renderEmail(
  subject: string,
  element: ReactElement
): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject, html, text };
}
