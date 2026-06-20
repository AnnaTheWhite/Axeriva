// Shared wrapper so every CrewFlow email looks consistent. Email clients
// need inline styles and table-safe markup — no external CSS, no flexbox.
export function emailLayout(bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background-color:#0f172a;padding:24px 32px;">
                <span style="font-size:20px;font-weight:bold;color:#ffffff;">Crew<span style="color:#f97316;">Flow</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#1e293b;font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#f8fafc;color:#94a3b8;font-size:12px;">
                CrewFlow — Workforce Management for Field Service Businesses
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function ctaButton(label: string, url: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background-color:#f97316;border-radius:10px;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}
