// HTML escaping for values interpolated into email templates (R1.5).
//
// Why this exists: `companyName` is attacker-controlled — anyone can put
// arbitrary markup in it at registration (POST /auth/register) or have it
// carried into an invitation sent to a third party. Interpolated raw into an
// email body it becomes stored HTML injection, and because the mail is sent
// from Axeriva's own verified domain (SPF/DKIM pass), an injected <a> is a
// phishing link with our reputation behind it.
//
// Applied inside the templates — the boundary where HTML is actually
// produced — so no caller can forget it. Plain-text bodies and subject lines
// are NOT escaped: they are not HTML, and escaping them would show literal
// "&amp;" to the reader.
const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

// `&` must be in the character class and is handled first by the map, so a
// pre-existing "&lt;" is escaped to "&amp;lt;" rather than passed through —
// double-escaping is safe here, under-escaping is not.
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}
