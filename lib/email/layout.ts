/**
 * Shared chrome for Ledger's transactional emails, in the default "clay"
 * palette (the light values from `app/globals.css`, frozen as hex because
 * email clients don't support CSS variables).
 *
 * Written for email clients, not browsers: table layout, inline styles, a
 * PNG logo (Gmail and Outlook don't render SVG) and system font fallbacks
 * behind the brand fonts. The `<style>` block only adds a dark palette for
 * clients that honor `prefers-color-scheme` (Apple Mail, iOS Mail, Outlook
 * for Mac); everywhere else the inline light styles stand on their own.
 */

export const COLORS = {
  paper: '#f6f2ee',
  paperRaised: '#ffffff',
  paperSunk: '#efe8e1',
  ink: '#231c17',
  inkMuted: '#6b5d53',
  line: '#e5dcd3',
  accent: '#a8622a',
  accentSoft: '#f7e9dc',
} as const;

export const DISPLAY_FONT = "'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const BODY_FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const MONO_FONT = "'IBM Plex Mono', SFMono-Regular, Menlo, Consolas, monospace";

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export type TransactionalEmail = { subject: string; html: string; text: string };

/**
 * Every string param is plain text and gets escaped here, except
 * `detailsHtml`, which is trusted markup the caller builds (and escapes)
 * itself.
 */
export const renderEmailHtml = ({
  appUrl,
  subject,
  preheader,
  heading,
  intro,
  buttonLabel,
  buttonUrl,
  detailsHtml = '',
  footer,
}: {
  appUrl: string;
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  buttonLabel: string;
  buttonUrl: string;
  detailsHtml?: string;
  footer: string;
}): string => {
  const href = escapeHtml(buttonUrl);
  const logo = escapeHtml(`${appUrl.replace(/\/$/, '')}/icons/icon-192.png`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .l-paper { background-color: #1a1614 !important; }
    .l-card { background-color: #241f1c !important; border-color: #332b27 !important; }
    .l-ink { color: #f1ebe6 !important; }
    .l-muted { color: #a89a92 !important; }
    .l-rule { border-color: #332b27 !important; }
    .l-link { color: #dc9048 !important; }
    .l-code { background-color: #120f0e !important; color: #a89a92 !important; }
    .l-button { background-color: #dc9048 !important; }
    .l-button a { color: #1a1614 !important; }
  }
  @media (max-width: 520px) {
    .l-card-pad { padding: 28px 22px !important; }
  }
</style>
</head>
<body class="l-paper" style="margin:0;padding:0;background-color:${COLORS.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" class="l-paper" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.paper};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td style="padding:0 4px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:10px;">
                  <img src="${logo}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;">
                </td>
                <td class="l-ink" style="vertical-align:middle;font-family:${DISPLAY_FONT};font-size:19px;font-weight:600;letter-spacing:-0.02em;color:${COLORS.ink};">Ledger</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="l-card l-card-pad" style="background-color:${COLORS.paperRaised};border:1px solid ${COLORS.line};border-radius:18px;padding:36px 36px 32px;">
            <h1 class="l-ink" style="margin:0 0 12px;font-family:${DISPLAY_FONT};font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:${COLORS.ink};">${escapeHtml(heading)}</h1>
            <p class="l-muted" style="margin:0 0 28px;font-family:${BODY_FONT};font-size:15px;line-height:1.6;color:${COLORS.inkMuted};">${escapeHtml(intro)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="l-button" align="center" bgcolor="${COLORS.accent}" style="border-radius:999px;background-color:${COLORS.accent};">
                  <a href="${href}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${BODY_FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(buttonLabel)}</a>
                </td>
              </tr>
            </table>${detailsHtml}
          </td>
        </tr>
        <tr>
          <td class="l-muted" style="padding:20px 8px 0;font-family:${BODY_FONT};font-size:12px;line-height:1.6;color:${COLORS.inkMuted};text-align:center;">${escapeHtml(footer)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
};
